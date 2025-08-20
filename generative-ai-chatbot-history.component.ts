  access_alias = aliased(UsableFlowAccess)
    flow_alias = aliased(Flow)

    stmt = (
        select(
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
            flow_alias.name.label("flow_name")
        )
        .join(
            access_alias,
            (access_alias.usableFlowId == UsableFlow.id) & 
            (access_alias.emails == current_user_mail),
            isouter=True
        )
        .join(
            flow_alias,
            flow_alias.id == UsableFlow.flowId,
            isouter=True
        )
        .where(UsableFlow.isDeleted == False)
    )

    result = await db.execute(stmt)
    return result.mappings().all()  # returns list of dicts
