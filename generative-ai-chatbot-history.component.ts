from fastapi import APIRouter, HTTPException, Query, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func, or_, and_
from typing import Optional, Dict, Any
from database import get_session  # your async session dependency
from models import User, UsableFlow, UsableFlowAccess, Flow, Execution, UsableFlowCategory, UsableFlowTools
from utils import sanitize_safe_text, capitalize_first_char
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/usable-flows")
async def list_all_usable_flows(
    skip: int = 0,
    limit: int = 10,
    userId: str = Query(...),
    isAdminScreen: bool = Query(False),
    searchTerm: Optional[str] = None,
    categoryId: Optional[str] = None,
    sortField: Optional[str] = None,
    sortOrder: Optional[str] = None,
    session: AsyncSession = Depends(get_session),
):
    # 🔑 Get user
    result = await session.execute(select(User).where(User.id == userId))
    user = result.scalar_one_or_none()
    if not user:
        logger.error(f"User not found with ID: {userId}")
        raise HTTPException(status_code=404, detail="User not found")

    isSuperAdmin = user.is_superuser
    currentUserMail = user.email
    isAdmin = str(isAdminScreen).lower() == "true"

    # Base query
    query = select(
        UsableFlow.id,
        UsableFlow.flowId,
        UsableFlow.requireFile,
        UsableFlow.supportMultipleFiles,
        UsableFlow.supportedFileTypesIds,
        UsableFlow.createdBy,
        UsableFlow.lastUpdatedBy,
        UsableFlow.createdAt,
        UsableFlow.updatedAt,
        UsableFlow.isDeleted,
        UsableFlow.isActive,
        UsableFlow.description,
        UsableFlow.category,
        UsableFlow.tools,
        UsableFlow.status,
        UsableFlow.templateName,
        UsableFlow.chargeCode,
        UsableFlow.access,
        UsableFlow.iconBlobUrl,
        Flow.name.label("flow_name"),
    ).join(
        Flow, Flow.id == UsableFlow.flowId, isouter=True
    ).outerjoin(
        UsableFlowAccess,
        and_(
            UsableFlowAccess.usableFlowId == UsableFlow.id,
            UsableFlowAccess.emails == currentUserMail,
        )
    ).where(UsableFlow.isDeleted == False)

    # Filters for admin/non-admin
    if not isAdmin:
        query = query.where(
            UsableFlow.isActive == True,
            UsableFlow.status == "Published"  # adapt enum usage
        )

    if not isSuperAdmin:
        query = query.where(
            or_(
                UsableFlow.access == "public",
                and_(
                    UsableFlow.access == "specific",
                    UsableFlowAccess.id.isnot(None)
                )
            )
        )

    # 🔍 Search
    if searchTerm:
        sanitized = sanitize_safe_text(searchTerm)
        query = query.where(UsableFlow.templateName.ilike(f"%{sanitized}%"))

    # Sorting
    allowed_sort = ["templateName", "updatedAt"]
    if sortField in allowed_sort and sortOrder in ["asc", "desc"]:
        sort_col = getattr(UsableFlow, sortField)
        query = query.order_by(sort_col.asc() if sortOrder == "asc" else sort_col.desc())
    else:
        query = query.order_by(UsableFlow.updatedAt.desc())

    # Pagination
    query = query.offset(skip).limit(limit)

    # Fetch results
    result = await session.execute(query)
    usable_flows = result.fetchall()

    # Format usable flows
    usable_flows_list = []
    flow_ids = []
    for uf in usable_flows:
        flow_data = uf._asdict()
        flow_data["name"] = flow_data.pop("flow_name", None)
        usable_flows_list.append(flow_data)
        flow_ids.append(flow_data["id"])

    # Execution counts
    execution_counts = {}
    if flow_ids:
        exec_q = select(
            Execution.usableFlowId,
            func.count(Execution.id).label("count")
        ).where(Execution.usableFlowId.in_(flow_ids)).group_by(Execution.usableFlowId)
        exec_result = await session.execute(exec_q)
        for row in exec_result:
            execution_counts[row.usableFlowId] = row.count

    # Attach counts & user info
    final_flows = []
    for flow in usable_flows_list:
        flow["executionCount"] = execution_counts.get(flow["id"], 0)

        # creator
        creator = await session.execute(select(User.username).where(User.id == flow["createdBy"]))
        creator_name = creator.scalar_one_or_none()

        # updater
        updater = await session.execute(
            select(User.first_name, User.last_name).where(User.id == flow["lastUpdatedBy"])
        )
        upd_user = updater.first()
        updater_name = None
        if upd_user:
            updater_name = f"{capitalize_first_char(upd_user.first_name or '')} {capitalize_first_char(upd_user.last_name or '')}".strip()

        flow["creator"] = creator_name or "Unknown"
        flow["updater"] = updater_name or "Unknown"
        flow["description"] = flow["description"] or "No description available"

        # categories
        if flow["category"]:
            cat_q = await session.execute(
                select(UsableFlowCategory.name).where(UsableFlowCategory.id.in_(flow["category"]))
            )
            flow["categoryNames"] = [c.name for c in cat_q.scalars().all()]
        else:
            flow["categoryNames"] = []

        # tools
        if flow["tools"]:
            tool_q = await session.execute(
                select(UsableFlowTools.name).where(UsableFlowTools.id.in_(flow["tools"]))
            )
            flow["toolNames"] = [t.name for t in tool_q.scalars().all()]
        else:
            flow["toolNames"] = []

        final_flows.append(flow)

    # Latest updated template
    latest_q = await session.execute(
        select(UsableFlow.templateName).where(UsableFlow.isDeleted == False).order_by(UsableFlow.updatedAt.desc()).limit(1)
    )
    latest_flow = latest_q.scalar_one_or_none()

    # Counts summary
    count_q = select(
        func.sum(func.case((UsableFlow.status == "Published", 1), else_=0)).label("publishedCount"),
        func.sum(func.case((UsableFlow.status == "InDevelopment", 1), else_=0)).label("inDevelopmentCount"),
        func.sum(func.case((UsableFlow.isActive == True, 1), else_=0)).label("activeCount"),
        func.sum(func.case((UsableFlow.isActive == False, 1), else_=0)).label("inActiveCount"),
    ).where(UsableFlow.isDeleted == False)
    count_res = await session.execute(count_q)
    count_results = count_res.first()._asdict()

    total = count_results["publishedCount"] if not isAdmin else (
        count_results["publishedCount"] + count_results["inDevelopmentCount"]
    )

    return {
        "message": "Success" if total > 0 else "No records found",
        "usableFlows": final_flows,
        "total": total,
        "latestUpdatedTemplateName": latest_flow,
        "pageViewTotal": len(final_flows),
        "totalCountWithoutPagination": len(final_flows),
        "counts": count_results,
        "categoryCounts": {},  # TODO: implement like TS version if needed
    }
