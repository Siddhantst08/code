# ---- SERVICE ----
async def list_all_usable_flows(
    db: AsyncSession,
    skip: int = 0,
    limit: int = 10,
    userId: str = None,
    isAdminScreen: bool = False,
    searchTerm: Optional[str] = None,
    categoryId: Optional[str] = None,
    sortField: Optional[str] = None,
    sortOrder: Optional[SortOrder] = None,
) -> UsableFlowsResponse:
    
    # --- Fetch user ---
    user = await db.get(User, userId)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    isSuperAdmin = user.is_superuser
    currentUserMail = user.email

    # --- Base query ---
    query = select(UsableFlow).where(UsableFlow.isDeleted == False)

    if not isAdminScreen:
        query = query.where(
            UsableFlow.isActive == True,
            UsableFlow.status == "Published"
        )

    # --- Search ---
    if searchTerm:
        query = query.where(UsableFlow.templateName.ilike(f"%{searchTerm}%"))

    # --- Sorting ---
    if sortField in ["templateName", "updatedAt"] and sortOrder:
        if sortOrder == SortOrder.asc:
            query = query.order_by(getattr(UsableFlow, sortField).asc())
        else:
            query = query.order_by(getattr(UsableFlow, sortField).desc())
    else:
        query = query.order_by(UsableFlow.updatedAt.desc())

    # --- Pagination ---
    query = query.offset(skip).limit(limit)

    result = await db.execute(query)
    usable_flows = result.scalars().all()

    # --- Execution count per flow ---
    flow_ids = [uf.id for uf in usable_flows]
    exec_counts = {}
    if flow_ids:
        exec_query = (
            select(Execution.usableFlowId, func.count(Execution.id))
            .where(Execution.usableFlowId.in_(flow_ids))
            .group_by(Execution.usableFlowId)
        )
        exec_result = await db.execute(exec_query)
        exec_counts = {r[0]: r[1] for r in exec_result.all()}

    # --- Build response objects ---
    flows_out = []
    for uf in usable_flows:
        flows_out.append(
            UsableFlowWithCreatorName(
                id=uf.id,
                flowId=uf.flowId,
                templateName=uf.templateName,
                description=uf.description or "No description available",
                creator="TODO: fetch creator name",   # join with User table
                updater="TODO: fetch updater name",   # join with User table
                executionCount=exec_counts.get(uf.id, 0),
                categoryNames=["TODO: map categories"],
                toolNames=["TODO: map tools"],
                status=uf.status,
                isActive=uf.isActive,
                isDeleted=uf.isDeleted,
            )
        )

    # --- Latest flow ---
    latest_query = (
        select(UsableFlow.templateName)
        .where(UsableFlow.isDeleted == False)
        .order_by(UsableFlow.updatedAt.desc())
        .limit(1)
    )
    latest_result = await db.execute(latest_query)
    latest_updated_template_name = latest_result.scalar_one_or_none()

    # --- Counts ---
    count_query = (
        select(
            func.sum(case((UsableFlow.status == "Published", 1), else_=0)).label("publishedCount"),
            func.sum(case((UsableFlow.status == "InDevelopment", 1), else_=0)).label("inDevelopmentCount"),
            func.sum(case((UsableFlow.isActive == True, 1), else_=0)).label("activeCount"),
            func.sum(case((UsableFlow.isActive == False, 1), else_=0)).label("inActiveCount"),
        )
        .where(UsableFlow.isDeleted == False)
    )
    counts_res = await db.execute(count_query)
    counts = counts_res.first()

    return UsableFlowsResponse(
        message="Success" if flows_out else "No records found",
        usableFlows=flows_out,
        total=len(flows_out),
        pageViewTotal=len(flows_out),
        totalCountWithoutPagination=len(flows_out),  # adjust if needed
        latestUpdatedTemplateName=latest_updated_template_name,
        counts=Counts(
            publishedCount=counts.publishedCount or 0,
            inDevelopmentCount=counts.inDevelopmentCount or 0,
            activeCount=counts.activeCount or 0,
            inActiveCount=counts.inActiveCount or 0,
        ),
        categoryCounts={},  # TODO: implement category mapping
    )
