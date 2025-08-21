from sqlalchemy import create_engine, func, or_, and_, case, text, String, Integer, Boolean, select
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, aliased, joinedload, selectinload
from sqlalchemy.sql import select, exists
from typing import List, Dict, Any, Optional
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

class APIError(Exception):
    def __init__(self, message: str, status_code: int):
        self.message = message
        self.status_code = status_code
        super().__init__(message)

def capitalize_first_char(s: str) -> str:
    return s.capitalize() if s else ""

def sanitize_safe_text(text: str) -> str:
    return text.strip()

async def convert_code(session: AsyncSession, is_admin_screen: str, user_id: str, search_term: Optional[str] = None, 
                      sort_field: Optional[str] = None, sort_order: Optional[str] = None,
                      skip: int = 0, limit: int = 10, category_id: Optional[str] = None):
    
    is_admin = is_admin_screen.lower() == "true"
    
    # Get user details
    user_details = await session.execute(
        select(User).where(User.id == user_id)
    )
    user_details = user_details.scalar_one_or_none()
    
    if not user_details:
        logger.error("User not found with ID: %s", user_id)
        raise APIError("User not found", 404)
    
    is_super_admin = user_details.is_superuser
    current_user_mail = user_details.email
    
    # Create aliases
    access_alias = aliased(UsableFlowAccess)
    flow_alias = aliased(Flow)
    
    # Main query for usable flows with specific columns
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
        flow_alias.name.label('flow_name')
    ).select_from(UsableFlow) \
    .outerjoin(
        access_alias, 
        and_(
            access_alias.usableFlowId == UsableFlow.id,
            access_alias.emails == current_user_mail
        )
    ) \
    .outerjoin(flow_alias, flow_alias.id == UsableFlow.flowId) \
    .where(UsableFlow.isDeleted == False)
    
    # Apply non-admin filters
    if not is_admin:
        query = query.where(
            UsableFlow.isActive == True,
            UsableFlow.status == UsableFlowStatus.Published
        )
    
    # Apply access restrictions for non-super admins
    if not is_super_admin:
        query = query.where(
            or_(
                UsableFlow.access == "public",
                and_(
                    UsableFlow.access == "specific",
                    access_alias.id.isnot(None)
                )
            )
        )
    
    # Search term filter
    if search_term and len(search_term) > 0:
        sanitized = sanitize_safe_text(search_term)
        query = query.where(UsableFlow.templateName.ilike(f"%{sanitized}%"))
    
    # Sorting
    allowed_execution_sort_fields = ["templateName", "updatedAt"]
    if (sort_field and sort_order and 
        sort_field in allowed_execution_sort_fields and 
        sort_order in ["asc", "desc"]):
        logger.info("Applied custom sorting on usableFlow with 'usableFlow.%s %s'", sort_field, sort_order)
        if sort_order == "asc":
            query = query.order_by(getattr(UsableFlow, sort_field).asc())
        else:
            query = query.order_by(getattr(UsableFlow, sort_field).desc())
    else:
        query = query.order_by(UsableFlow.updatedAt.desc())
    
    # Pagination
    query = query.offset(skip).limit(limit)
    
    # Count query builder
    count_query = select(func.count()).select_from(UsableFlow) \
        .outerjoin(
            access_alias,
            and_(
                access_alias.usableFlowId == UsableFlow.id,
                access_alias.emails == current_user_mail
            )
        ) \
        .where(UsableFlow.isDeleted == False)
    
    # Apply same conditions to count query
    if not is_admin:
        count_query = count_query.where(
            UsableFlow.isActive == True,
            UsableFlow.status == UsableFlowStatus.Published
        )
    
    if not is_super_admin:
        count_query = count_query.where(
            or_(
                UsableFlow.access == "public",
                and_(
                    UsableFlow.access == "specific",
                    access_alias.id.isnot(None)
                )
            )
        )
    
    if search_term and len(search_term) > 0:
        sanitized = sanitize_safe_text(search_term)
        count_query = count_query.where(UsableFlow.templateName.ilike(f"%{sanitized}%"))
    
    total_count_without_pagination = 0
    if not is_admin:
        total_count_result = await session.execute(count_query)
        total_count_without_pagination = total_count_result.scalar() or 0
    
    # Get count results with aggregated data
    count_results_query = select(
        func.coalesce(func.sum(case((UsableFlow.status == UsableFlowStatus.Published, 1), else_=0)), 0).label("publishedCount"),
        func.coalesce(func.sum(case((UsableFlow.status == UsableFlowStatus.InDevelopment, 1), else_=0)), 0).label("inDevelopmentCount"),
        func.coalesce(func.sum(case((UsableFlow.isActive == True, 1), else_=0)), 0).label("activeCount"),
        func.coalesce(func.sum(case((UsableFlow.isActive == False, 1), else_=0)), 0).label("inActiveCount"),
        func.coalesce(func.sum(case((and_(UsableFlow.status == UsableFlowStatus.Published, UsableFlow.isActive == True), 1), else_=0)), 0).label("activePublishedCount")
    ).select_from(UsableFlow) \
    .outerjoin(
        access_alias,
        and_(
            access_alias.usableFlowId == UsableFlow.id,
            access_alias.emails == current_user_mail
        )
    ) \
    .where(UsableFlow.isDeleted == False)
    
    # Apply same conditions to count results query
    if not is_admin:
        count_results_query = count_results_query.where(
            UsableFlow.isActive == True,
            UsableFlow.status == UsableFlowStatus.Published
        )
    
    if not is_super_admin:
        count_results_query = count_results_query.where(
            or_(
                UsableFlow.access == "public",
                and_(
                    UsableFlow.access == "specific",
                    access_alias.id.isnot(None)
                )
            )
        )
    
    if search_term and len(search_term) > 0:
        sanitized = sanitize_safe_text(search_term)
        count_results_query = count_results_query.where(UsableFlow.templateName.ilike(f"%{sanitized}%"))
    
    count_results_result = await session.execute(count_results_query)
    count_results_row = count_results_result.first()
    
    count_results = {
        "publishedCount": count_results_row[0] if count_results_row else 0,
        "inDevelopmentCount": count_results_row[1] if count_results_row else 0,
        "activeCount": count_results_row[2] if count_results_row else 0,
        "inActiveCount": count_results_row[3] if count_results_row else 0,
        "activePublishedCount": count_results_row[4] if count_results_row else 0
    }
    
    if is_admin:
        count_results["totalCount"] = count_results["publishedCount"] + count_results["inDevelopmentCount"]
    
    # Category count
    category_count_query = select(
        func.unnest(UsableFlow.category).label("category_id"),
        UsableFlow.status,
        func.count().label("count")
    ).select_from(UsableFlow) \
    .outerjoin(
        access_alias,
        and_(
            access_alias.usableFlowId == UsableFlow.id,
            access_alias.emails == current_user_mail
        )
    ) \
    .where(UsableFlow.isDeleted == False) \
    .group_by("category_id", UsableFlow.status)
    
    # Apply same conditions to category count query
    if not is_admin:
        category_count_query = category_count_query.where(
            UsableFlow.isActive == True,
            UsableFlow.status == UsableFlowStatus.Published
        )
    
    if not is_super_admin:
        category_count_query = category_count_query.where(
            or_(
                UsableFlow.access == "public",
                and_(
                    UsableFlow.access == "specific",
                    access_alias.id.isnot(None)
                )
            )
        )
    
    if search_term and len(search_term) > 0:
        sanitized = sanitize_safe_text(search_term)
        category_count_query = category_count_query.where(UsableFlow.templateName.ilike(f"%{sanitized}%"))
    
    category_count_result = await session.execute(category_count_query)
    category_count_raw = category_count_result.all()
    
    category_count_map = {}
    for row in category_count_raw:
        category_id, status, count = row
        if category_id not in category_count_map:
            category_count_map[category_id] = {"statuses": {}}
        category_count_map[category_id]["statuses"][status] = category_count_map[category_id]["statuses"].get(status, 0) + count
    
    # Apply category filter if needed
    if category_id:
        query = query.where(UsableFlow.category.any(category_id))
        count_query = count_query.where(UsableFlow.category.any(category_id))
    
    # Fetch usable flows
    usable_flows_result = await session.execute(query)
    usable_flows_results = usable_flows_result.all()
    
    # Transform results
    usable_flows = []
    for result in usable_flows_results:
        usable_flow_dict = {
            "id": result[0],
            "flowId": result[1],
            "requireFile": result[2],
            "supportMultipleFiles": result[3],
            "supportedFileTypesIds": result[4],
            "createdBy": result[5],
            "lastUpdatedBy": result[6],
            "createdAt": result[7],
            "updatedAt": result[8],
            "isDeleted": result[9],
            "isActive": result[10],
            "description": result[11],
            "category": result[12],
            "tools": result[13],
            "status": result[14],
            "templateName": result[15],
            "chargeCode": result[16],
            "access": result[17],
            "iconBlobUrl": result[18],
            "name": result[19]  # flow_name
        }
        usable_flows.append(usable_flow_dict)
    
    flow_ids = [flow["id"] for flow in usable_flows]
    
    execution_counts = []
    if flow_ids:
        execution_counts_query = select(
            Execution.usableFlowId,
            func.count(Execution.id).label("count")
        ).where(Execution.usableFlowId.in_(flow_ids)).group_by(Execution.usableFlowId)
        
        execution_counts_result = await session.execute(execution_counts_query)
        execution_counts = execution_counts_result.all()
    
    for flow in usable_flows:
        count_data = next((ec for ec in execution_counts if ec[0] == flow["id"]), None)
        flow["executionCount"] = count_data[1] if count_data else 0
    
    # Fetch additional user and category information
    usable_flows_with_user_names = []
    
    for flow in usable_flows:
        # Get created by user
        created_by_user_result = await session.execute(
            select(User.username).where(User.id == flow["createdBy"])
        )
        created_by_user = created_by_user_result.scalar_one_or_none()
        
        # Get last updated by user
        last_updated_by_user_result = await session.execute(
            select(User.first_name, User.last_name).where(User.id == flow["lastUpdatedBy"])
        )
        last_updated_by_user = last_updated_by_user_result.first()
        
        # Get category names
        category_names = []
        if flow["category"]:
            category_names_result = await session.execute(
                select(UsableFlowCategory.name).where(
                    UsableFlowCategory.id.in_(flow["category"])
                )
            )
            category_names = category_names_result.scalars().all()
        
        # Get tool names
        tool_names = []
        if flow["tools"]:
            tool_names_result = await session.execute(
                select(UsableFlowTools.name).where(
                    UsableFlowTools.id.in_(flow["tools"])
                )
            )
            tool_names = tool_names_result.scalars().all()
        
        def get_full_name(user_tuple):
            if not user_tuple:
                return "Unknown"
            first_name = capitalize_first_char(user_tuple[0] or "").strip()
            last_name = capitalize_first_char(user_tuple[1] or "").strip()
            return f"{first_name} {last_name}".strip()
        
        usable_flows_with_user_names.append({
            **flow,
            "creator": created_by_user if created_by_user else "Unknown",
            "updater": get_full_name(last_updated_by_user) if last_updated_by_user else "Unknown",
            "updatedAt": flow["updatedAt"] or flow["createdAt"],
            "isDeleted": flow["isDeleted"] or False,
            "isActive": flow["isActive"] or True,
            "description": flow["description"] or "No description available",
            "categoryNames": category_names,
            "toolNames": tool_names,
            "status": flow["status"],
            "templateName": flow["templateName"],
            "ChargeCodeStatus": flow["chargeCode"]
        })
    
    # Get latest flow
    latest_flow_result = await session.execute(
        select(UsableFlow.templateName).where(
            UsableFlow.isDeleted == False
        ).order_by(UsableFlow.updatedAt.desc()).limit(1)
    )
    latest_flow = latest_flow_result.scalar_one_or_none()
    
    latest_updated_template_name = latest_flow if latest_flow else None
    
    total = count_results["activePublishedCount"]
    if is_admin:
        total = count_results["totalCount"]
    
    return {
        "usableFlows": usable_flows_with_user_names,
        "countResults": count_results,
        "categoryCountMap": category_count_map,
        "totalCountWithoutPagination": total_count_without_pagination,
        "latestUpdatedTemplateName": latest_updated_template_name,
        "total": total
    }
