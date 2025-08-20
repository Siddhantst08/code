const queryBuilder = await connection
      .createQueryBuilder(UsableFlow, "usableFlow")
      .leftJoin(
        UsableFlowAccess,
        "access",
        "access.usableFlowId = usableFlow.id AND access.emails = :email",
        { email: currentUserMail }
      )
      .leftJoinAndMapOne(
        "usableFlow.flow",
        Flow,
        "flow",
        "flow.id = usableFlow.flowId"
      )
      .select([
        "usableFlow.id",
        "usableFlow.flowId",
        "usableFlow.requireFile",
        "usableFlow.supportMultipleFiles",
        "usableFlow.supportedFileTypesIds",
        "usableFlow.createdBy",
        "usableFlow.lastUpdatedBy",
        "usableFlow.createdAt",
        "usableFlow.updatedAt",
        "usableFlow.isDeleted",
        "usableFlow.isActive",
        "usableFlow.description",
        "usableFlow.category",
        "usableFlow.tools",
        "usableFlow.status",
        "usableFlow.templateName",
        "usableFlow.chargeCode",
        "usableFlow.access",
        "usableFlow.iconBlobUrl",
      ])
      .addSelect("flow.name")
      .where("usableFlow.isDeleted = false");
