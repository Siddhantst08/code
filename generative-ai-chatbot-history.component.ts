from sqlalchemy import create_engine, func, or_, and_, case, text, String, Integer, Boolean
from sqlalchemy.orm import sessionmaker, aliased, joinedload
from sqlalchemy.sql import select, exists
from typing import List, Dict, Any, Optional
import logging
from datetime import datetime

# Assuming you have your models defined similarly to your TypeScript entities
# User, UsableFlow, UsableFlowAccess, Flow, Execution, UsableFlowCategory, UsableFlowTools

logger = logging.getLogger(__name__)

class APIError(Exception):
    def __init__(self, message: str, status_code: int):
        self.message = message
        self.status_code = status_code
        super().__init__(message)

def capitalize_first_char(s: str) -> str:
    return s.capitalize() if s else ""

def sanitize_safe_text(text: str) -> str:
    # Implement your sanitization logic here
    return text.strip()

async def convert_code(session, is_admin_screen: str, user_id: str, search_term: Optional[str] = None, 
                      sort_field: Optional[str] = None, sort_order: Optional[str] = None,
                      skip: int = 0, limit: int = 10, category_id: Optional[str] = None):
    
    is_admin = is_admin_screen.lower() == "true"
    
    # Get user details
    user_details = session.query(User).filter(User.id == user_id).first()
    if not user_details:
        logger.error("User not found with ID: %s", user_id)
        raise APIError("User not found", 404)
    
    is_super_admin = user_details.is_superuser
    current_user_mail = user_details.email
    
    # Main query for usable flows
    query = session.query(UsableFlow).filter(UsableFlow.isDeleted == False)
    
    # Left join with access
    access_alias = aliased(UsableFlowAccess)
    query = query.outerjoin(
        access_alias, 
        and_(
            access_alias.usableFlowId == UsableFlow.id,
            access_alias.emails == current_user_mail
        )
    )
    
    # Left join with flow
    flow_alias = aliased(Flow)
    query = query.outerjoin(flow_alias, flow_alias.id == UsableFlow.flowId)
    
    # Select specific columns
    query = query.with_entities(
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
    )
    
    # Apply non-admin filters
    if not is_admin:
        query = query.filter(
            UsableFlow.isActive == True,
            UsableFlow.status == UsableFlowStatus.Published
        )
    
    # Apply access restrictions for non-super admins
    if not is_super_admin:
        query = query.filter(
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
        query = query.filter(UsableFlow.templateName.ilike(f"%{sanitized}%"))
    
    # Sorting
    allowed_execution_sort_fields = ["templateName", "updatedAt"]
    if (sort_field and sort_order and 
        sort_field in allowed_execution_sort_fields and 
        sort_order in ["asc", "desc"]):
        logger.info("Applied custom sorting on usableFlow with 'usableFlow.%s %s'", sort_field, sort_order)
        order_by_clause = getattr(getattr(UsableFlow, sort_field), sort_order)()
        query = query.order_by(order_by_clause)
    else:
        query = query.order_by(UsableFlow.updatedAt.desc())
    
    # Pagination
    query = query.offset(skip).limit(limit)
    
    # Count query builder
    count_query = session.query(UsableFlow).filter(UsableFlow.isDeleted == False)
    count_query = count_query.outerjoin(
        access_alias,
        and_(
            access_alias.usableFlowId == UsableFlow.id,
            access_alias.emails == current_user_mail
        )
    )
    
    # Apply same conditions to count query
    if not is_admin:
        count_query = count_query.filter(
            UsableFlow.isActive == True,
            UsableFlow.status == UsableFlowStatus.Published
        )
    
    if not is_super_admin:
        count_query = count_query.filter(
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
        count_query = count_query.filter(UsableFlow.templateName.ilike(f"%{sanitized}%"))
    
    total_count_without_pagination = 0
    if not is_admin:
        total_count_without_pagination = count_query.count()
    
    # Get count results
    count_results = count_query.with_entities(
        func.coalesce(func.sum(case((UsableFlow.status == UsableFlowStatus.Published, 1), else_=0)), 0).label("publishedCount"),
        func.coalesce(func.sum(case((UsableFlow.status == UsableFlowStatus.InDevelopment, 1), else_=0)), 0).label("inDevelopmentCount"),
        func.coalesce(func.sum(case((UsableFlow.isActive == True, 1), else_=0)), 0).label("activeCount"),
        func.coalesce(func.sum(case((UsableFlow.isActive == False, 1), else_=0)), 0).label("inActiveCount"),
        func.coalesce(func.sum(case((and_(UsableFlow.status == UsableFlowStatus.Published, UsableFlow.isActive == True), 1), else_=0)), 0).label("activePublishedCount")
    ).first() or {
        "publishedCount": 0,
        "inDevelopmentCount": 0,
        "activeCount": 0,
        "inActiveCount": 0,
        "activePublishedCount": 0
    }
    
    if is_admin:
        count_results["totalCount"] = count_results["publishedCount"] + count_results["inDevelopmentCount"]
    
    # Category count
    category_count_raw = count_query.with_entities(
        func.unnest(UsableFlow.category).label("category_id"),
        UsableFlow.status,
        func.count().label("count")
    ).group_by("category_id", UsableFlow.status).all()
    
    category_count_map = {}
    for row in category_count_raw:
        category_id = row.category_id
        status = row.status
        count = row.count
        
        if category_id not in category_count_map:
            category_count_map[category_id] = {"statuses": {}}
        
        category_count_map[category_id]["statuses"][status] = category_count_map[category_id]["statuses"].get(status, 0) + count
    
    # Apply category filter if needed
    if category_id:
        query = query.filter(UsableFlow.category.any(category_id))
        count_query = count_query.filter(UsableFlow.category.any(category_id))
    
    # Fetch usable flows
    usable_flows_results = query.all()
    
    # Transform results
    usable_flows = []
    for result in usable_flows_results:
        usable_flow_dict = {
            "id": result.id,
            "flowId": result.flowId,
            "requireFile": result.requireFile,
            "supportMultipleFiles": result.supportMultipleFiles,
            "supportedFileTypesIds": result.supportedFileTypesIds,
            "createdBy": result.createdBy,
            "lastUpdatedBy": result.lastUpdatedBy,
            "createdAt": result.createdAt,
            "updatedAt": result.updatedAt,
            "isDeleted": result.isDeleted,
            "isActive": result.isActive,
            "description": result.description,
            "category": result.category,
            "tools": result.tools,
            "status": result.status,
            "templateName": result.templateName,
            "chargeCode": result.chargeCode,
            "access": result.access,
            "iconBlobUrl": result.iconBlobUrl,
            "name": result.flow_name
        }
        usable_flows.append(usable_flow_dict)
    
    flow_ids = [flow["id"] for flow in usable_flows]
    
    execution_counts = []
    if flow_ids:
        execution_counts = session.query(
            Execution.usableFlowId,
            func.count(Execution.id).label("count")
        ).filter(Execution.usableFlowId.in_(flow_ids)).group_by(Execution.usableFlowId).all()
    
    for flow in usable_flows:
        count_data = next((ec for ec in execution_counts if ec.usableFlowId == flow["id"]), None)
        flow["executionCount"] = count_data.count if count_data else 0
    
    # Fetch additional user and category information
    usable_flows_with_user_names = []
    
    for flow in usable_flows:
        # Get created by user
        created_by_user = session.query(User.username).filter(User.id == flow["createdBy"]).first()
        
        # Get last updated by user
        last_updated_by_user = session.query(User.first_name, User.last_name).filter(User.id == flow["lastUpdatedBy"]).first()
        
        # Get category names
        category_names = []
        if flow["category"]:
            category_names = session.query(UsableFlowCategory.name).filter(
                UsableFlowCategory.id.in_(flow["category"])
            ).all()
        
        # Get tool names
        tool_names = []
        if flow["tools"]:
            tool_names = session.query(UsableFlowTools.name).filter(
                UsableFlowTools.id.in_(flow["tools"])
            ).all()
        
        def get_full_name(user):
            if not user:
                return "Unknown"
            first_name = capitalize_first_char(user.first_name or "").strip()
            last_name = capitalize_first_char(user.last_name or "").strip()
            return f"{first_name} {last_name}".strip()
        
        usable_flows_with_user_names.append({
            **flow,
            "creator": created_by_user.username if created_by_user else "Unknown",
            "updater": get_full_name(last_updated_by_user) if last_updated_by_user else "Unknown",
            "updatedAt": flow["updatedAt"] or flow["createdAt"],
            "isDeleted": flow["isDeleted"] or False,
            "isActive": flow["isActive"] or True,
            "description": flow["description"] or "No description available",
            "categoryNames": [cat.name for cat in category_names],
            "toolNames": [tool.name for tool in tool_names],
            "status": flow["status"],
            "templateName": flow["templateName"],
            "ChargeCodeStatus": flow["chargeCode"]
        })
    
    # Get latest flow
    latest_flow = session.query(UsableFlow.templateName).filter(
        UsableFlow.isDeleted == False
    ).order_by(UsableFlow.updatedAt.desc()).first()
    
    latest_updated_template_name = latest_flow.templateName if latest_flow else None
    
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
