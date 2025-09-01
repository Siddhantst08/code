# --- helpers ---------------------------------------------------------------

def coalesce_bool(value, default):
    # Emulate JS "??" for booleans: only fall back when value is None
    return default if value is None else value

def coalesce_str(value, default):
    # Match JS "||" for strings (fallback on empty string too), if desired
    return value if (value is not None and value != "") else default

# --- common filters builder ------------------------------------------------

base_filters = [UsableFlow.isDeleted == False]

if not is_admin:
    # Node adds these to countQueryBuilder when !isAdmin
    base_filters += [
        UsableFlow.isActive == True,
        UsableFlow.status == UsableFlowStatus.Published.value,
    ]

if not is_super_admin:
    base_filters.append(
        or_(
            UsableFlow.access == AccessType.Public.value,
            and_(
                UsableFlow.access == AccessType.Specific.value,
                # left join + "access.id IS NOT NULL"
                # -> SQLAlchemy form:
                literal(True).op("IS NOT")(access_alias.id == None)
            ),
        )
    )

if searchTerm and len(searchTerm) > 0:
    sanitized = sanitizeSafeText(searchTerm)
    base_filters.append(UsableFlow.templateName.ilike(f"%{sanitized}%"))

# NOTE: Category filter is applied LATER to main "query" and "count_query"
# (to match your Node order), NOT to category_count_query.

# --- simple count (without pagination) ------------------------------------

count_query = (
    select(func.count())
    .select_from(UsableFlow)
    .outerjoin(
        access_alias,
        and_(
            access_alias.usableFlowId == UsableFlow.id,
            access_alias.emails == current_user_mail,
        ),
    )
    .where(*base_filters)
)

total_count_without_pagination = 0
if not is_admin:
    total_count_result = await session.execute(count_query)
    total_count_without_pagination = total_count_result.scalar() or 0

# --- aggregated counts (published/inDev/active/inActive/activePublished) ---

count_results_query = (
    select(
        func.coalesce(
            func.sum(
                case(
                    (UsableFlow.status == UsableFlowStatus.Published.value, 1),
                    else_=0,
                )
            ),
            0,
        ).label("publishedCount"),
        func.coalesce(
            func.sum(
                case(
                    (UsableFlow.status == UsableFlowStatus.InDevelopment.value, 1),
                    else_=0,
                )
            ),
            0,
        ).label("inDevelopmentCount"),
        func.coalesce(
            func.sum(case((UsableFlow.isActive == True, 1), else_=0)), 0
        ).label("activeCount"),
        func.coalesce(
            func.sum(case((UsableFlow.isActive == False, 1), else_=0)), 0
        ).label("inActiveCount"),
        func.coalesce(
            func.sum(
                case(
                    (
                        and_(
                            UsableFlow.status == UsableFlowStatus.Published.value,
                            UsableFlow.isActive == True,
                        ),
                        1,
                    ),
                    else_=0,
                )
            ),
            0,
        ).label("activePublishedCount"),
    )
    .select_from(UsableFlow)
    .outerjoin(
        access_alias,
        and_(
            access_alias.usableFlowId == UsableFlow.id,
            access_alias.emails == current_user_mail,
        ),
    )
    .where(*base_filters)
)

# (Optional) If duplicate access rows can exist, wrap with a distinct subquery:
# distinct_ids = (
#     select(UsableFlow.id)
#     .select_from(UsableFlow)
#     .outerjoin(access_alias,
#         and_(access_alias.usableFlowId == UsableFlow.id,
#              access_alias.emails == current_user_mail))
#     .where(*base_filters)
#     .distinct()
#     .subquery()
# )
# count_results_query = (
#     select(
#         func.coalesce(func.sum(case((UsableFlow.status == UsableFlowStatus.Published.value, 1), else_=0)), 0).label("publishedCount"),
#         ...
#     )
#     .select_from(UsableFlow)
#     .join(distinct_ids, distinct_ids.c.id == UsableFlow.id)
# )

count_results_row = (await session.execute(count_results_query)).first()

count_results = {
    "publishedCount": count_results_row[0] if count_results_row else 0,
    "inDevelopmentCount": count_results_row[1] if count_results_row else 0,
    "activeCount": count_results_row[2] if count_results_row else 0,
    "inActiveCount": count_results_row[3] if count_results_row else 0,
    "activePublishedCount": count_results_row[4] if count_results_row else 0,
}
if is_admin:
    count_results["totalCount"] = (
        count_results["publishedCount"] + count_results["inDevelopmentCount"]
    )

# --- category counts (pre-category filter, same as Node) -------------------

category_count_query = (
    select(
        func.unnest(UsableFlow.category).label("categoryId"),
        UsableFlow.status,
        func.count().label("count"),
    )
    .select_from(UsableFlow)
    .outerjoin(
        access_alias,
        and_(
            access_alias.usableFlowId == UsableFlow.id,
            access_alias.emails == current_user_mail,
        ),
    )
    .where(*base_filters)
    .group_by("categoryId", UsableFlow.status)
)

category_count_raw = (await session.execute(category_count_query)).all()

category_count_map = {}
for categoryId, status, cnt in category_count_raw:
    bucket = category_count_map.setdefault(categoryId, {"statuses": {}})
    bucket["statuses"][status] = bucket["statuses"].get(status, 0) + cnt

# --- apply category filter *after* computing category_count_map ------------

if categoryId:
    query = query.where(UsableFlow.category.any(categoryId))
    count_query = count_query.where(UsableFlow.category.any(categoryId))
    # (Intentionally NOT applying to count_results_query or category_count_query
    #  to mirror the Node order/behavior.)

# --- build usable_flows list (mapping with correct nullish semantics) ------

usable_flows_result = await session.execute(query)
rows = usable_flows_result.all()

usable_flows = []
for r in rows:
    flow = {
        "id": r[0],
        "flowId": r[1],
        "requireFile": r[2],
        "supportMultipleFiles": r[3],
        "supportedFileTypesIds": r[4],
        "createdBy": r[5],
        "lastUpdatedBy": r[6],
        "createdAt": r[7],
        "updatedAt": r[8],
        "isDeleted": coalesce_bool(r[9], False),
        "isActive": coalesce_bool(r[10], True),   # <-- FIXED
        "description": coalesce_str(r[11], "No description available"),
        "category": r[12],
        "tools": r[13],
        "status": r[14],
        "templateName": r[15],
        "chargeCode": r[16],
        "access": r[17],
        "iconBlobUrl": r[18],
        "name": r[19],
    }
    usable_flows.append(flow)

# --- execution counts (unchanged) ------------------------------------------

flow_ids = [f["id"] for f in usable_flows]
execution_counts = []
if flow_ids:
    execution_counts_query = (
        select(Execution.usableFlowId, func.count(Execution.id).label("count"))
        .where(Execution.usableFlowId.in_(flow_ids))
        .group_by(Execution.usableFlowId)
    )
    execution_counts = (await session.execute(execution_counts_query)).all()

for flow in usable_flows:
    ec = next((e for e in execution_counts if e[0] == flow["id"]), None)
    flow["executionCount"] = ec[1] if ec else 0

# --- fetch names & finalize (with fixed nullish logic) ---------------------

usable_flows_with_user_names = []
for flow in usable_flows:
    created_by_user = (await session.execute(
        select(User.username).where(User.id == flow["createdBy"])
    )).scalar_one_or_none()

    last_updated_by_user = (await session.execute(
        select(User.first_name, User.last_name).where(User.id == flow["lastUpdatedBy"])
    )).first()

    category_names = []
    if flow["category"]:
        category_names = (await session.execute(
            select(UsableFlowCategory.name).where(
                UsableFlowCategory.id.in_(flow["category"])
            )
        )).scalars().all()

    tool_names = []
    if flow["tools"]:
        tool_names = (await session.execute(
            select(UsableFlowTools.name).where(
                UsableFlowTools.id.in_(flow["tools"])
            )
        )).scalars().all()

    usable_flows_with_user_names.append(
        {
            **flow,
            "creator": created_by_user if created_by_user else "Unknown",
            "updater": get_full_name(last_updated_by_user)
            if last_updated_by_user else "Unknown",
            "updatedAt": flow["updatedAt"] or flow["createdAt"],
            # coalesce_bool already applied above
            "categoryNames": category_names,
            "toolNames": tool_names,
            "ChargeCodeStatus": flow["chargeCode"],
        }
    )

# --- latest flow & total ---------------------------------------------------

latest_flow = (await session.execute(
    select(UsableFlow.templateName)
    .where(UsableFlow.isDeleted == False)
    .order_by(UsableFlow.updatedAt.desc())
    .limit(1)
)).scalar_one_or_none()

latest_updated_template_name = latest_flow if latest_flow else None

total = count_results["activePublishedCount"]
if is_admin:
    total = count_results["totalCount"]
