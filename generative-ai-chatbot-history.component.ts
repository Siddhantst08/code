  async listAllUsableFlows(
    skip: number = 0,
    limit: number = 10,
    userId: string,
    isAdminScreen: boolean,
    searchTerm?: string,
    categoryId?: string,
    sortField?: string,
    sortOrder?: SortOrder
  ): Promise<{
    message: string;
    usableFlows: UsableFlowWithCreatorName[];
    total: number;
    pageViewTotal: number;
    totalCountWithoutPagination: number;
    latestUpdatedTemplateName: string | null;
    counts: {
      publishedCount: number;
      inDevelopmentCount: number;
      activeCount: number;
      inActiveCount: number;
    };
    categoryCounts: Record<string, { statuses: Record<string, number> }>;
  }> {
    const connection = getConnection();

    const isAdmin: boolean = String(isAdminScreen).toLowerCase() === "true";
    const userDetails = await connection
      .createQueryBuilder(User, "userDetails")
      .where("userDetails.id = :userId", { userId })
      .getOne();

    if (!userDetails) {
      logger.error("User not found with ID: {}", userId);
      throw new APIError("User not found", 404);
    }

    const isSuperAdmin = userDetails.is_superuser;
    const currentUserMail = userDetails.email;

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

    if (!isAdmin) {
      queryBuilder
        .andWhere("usableFlow.isActive = true")
        .andWhere("usableFlow.status = :publishedStatus", {
          publishedStatus: UsableFlowStatus.Published,
        });
    }

    queryBuilder.andWhere(
      new Brackets((qb) => {
        if (!isSuperAdmin) {
          qb.where("usableFlow.access = :publicAccess", {
            publicAccess: "public",
          }).orWhere(
            new Brackets((qb2) => {
              qb2
                .where("usableFlow.access = :specificAccess", {
                  specificAccess: "specific",
                })
                .andWhere("access.id IS NOT NULL");
            })
          );
        }
      })
    );

    // 🔍 Add search condition if searchTerm is provided
    if (searchTerm && searchTerm.length > 0) {
      const sanitized = sanitizeSafeText(searchTerm);
      queryBuilder.andWhere("usableFlow.templateName ILIKE :searchTerm", {
        searchTerm: `%${sanitized}%`,
      });
    }

    // Apply sorting BEFORE executing any queries
    const allowedExecutionSortFields = ["templateName", "updatedAt"];
    if (
      sortField &&
      sortOrder &&
      allowedExecutionSortFields.includes(sortField) &&
      [SortOrder.asc, SortOrder.desc].includes(sortOrder)
    ) {
      logger.info(
        `Applied custom sorting on usableFlow with 'usableFlow.${sortField} ${sortOrder}'`
      );
      queryBuilder.orderBy(`usableFlow.${sortField}`, sortOrder);
    } else {
      queryBuilder.orderBy("usableFlow.updatedAt", "DESC");
    }

    // ✅ Always apply pagination
    queryBuilder.skip(skip).take(limit);

    // Create a separate query builder for count operations
    const countQueryBuilder = connection
      .createQueryBuilder(UsableFlow, "usableFlow")
      .leftJoin(
        UsableFlowAccess,
        "access",
        "access.usableFlowId = usableFlow.id AND access.emails = :email",
        { email: currentUserMail }
      )
      .where("usableFlow.isDeleted = false");

    // Apply the same conditions to count query
    if (!isAdmin) {
      countQueryBuilder
        .andWhere("usableFlow.isActive = true")
        .andWhere("usableFlow.status = :publishedStatus", {
          publishedStatus: UsableFlowStatus.Published,
        });
    }

    countQueryBuilder.andWhere(
      new Brackets((qb) => {
        if (!isSuperAdmin) {
          qb.where("usableFlow.access = :publicAccess", {
            publicAccess: "public",
          }).orWhere(
            new Brackets((qb2) => {
              qb2
                .where("usableFlow.access = :specificAccess", {
                  specificAccess: "specific",
                })
                .andWhere("access.id IS NOT NULL");
            })
          );
        }
      })
    );

    if (searchTerm && searchTerm.length > 0) {
      const sanitized = sanitizeSafeText(searchTerm);
      countQueryBuilder.andWhere("usableFlow.templateName ILIKE :searchTerm", {
        searchTerm: `%${sanitized}%`,
      });
    }

    let totalCountWithoutPagination = 0;
    if (!isAdmin) {
      totalCountWithoutPagination = await countQueryBuilder.getCount();
    }

    // Now run the count query
    const countResults = (await countQueryBuilder
      .select([
        `COALESCE(SUM(CASE WHEN usableFlow.status = '${UsableFlowStatus.Published}' THEN 1 ELSE 0 END), 0) as "publishedCount"`,
        `COALESCE(SUM(CASE WHEN usableFlow.status = '${UsableFlowStatus.InDevelopment}' THEN 1 ELSE 0 END), 0) as "inDevelopmentCount"`,
        `COALESCE(SUM(CASE WHEN usableFlow.isActive = true THEN 1 ELSE 0 END), 0) AS "activeCount"`,
        `COALESCE(SUM(CASE WHEN usableFlow.isActive = false THEN 1 ELSE 0 END), 0) AS "inActiveCount"`,
        `COALESCE(SUM(CASE WHEN usableFlow.status = '${UsableFlowStatus.Published}' AND usableFlow.isActive = true THEN 1 ELSE 0 END), 0) AS "activePublishedCount"`,
      ])
      .getRawOne()) || {
      publishedCount: 0,
      inDevelopmentCount: 0,
      activeCount: 0,
      inActiveCount: 0,
      activePublishedCount: 0,
    };

    // Add totalCount if user is admin
    if (isAdmin) {
      countResults.totalCount =
        parseInt(countResults.publishedCount) +
        parseInt(countResults.inDevelopmentCount);
    }

    const categoryCountRaw = await countQueryBuilder
      .select(`unnest("usableFlow"."category")`, "category_id")
      .addSelect(`"usableFlow"."status"`, "status")
      .addSelect("COUNT(*)", "count")
      .groupBy(`category_id, "usableFlow"."status"`)
      .getRawMany();

    const categoryCountMap: Record<
      string,
      { statuses: Record<string, number> }
    > = {};

    categoryCountRaw.forEach((row: any) => {
      const categoryId = row.category_id;
      const status = row.status;
      const count = parseInt(row.count);

      if (!categoryCountMap[categoryId]) {
        categoryCountMap[categoryId] = {
          statuses: {},
        };
      }
      categoryCountMap[categoryId].statuses[status] =
        (categoryCountMap[categoryId].statuses[status] || 0) + count;
    });

    // THEN apply category filter if needed
    if (categoryId) {
      queryBuilder.andWhere(":categoryId = ANY(usableFlow.category)", {
        categoryId,
      });
      countQueryBuilder.andWhere(":categoryId = ANY(usableFlow.category)", {
        categoryId,
      });
    }

    // Fetch usable flows using the main query builder
    let usableFlows: CustomUsableFlow[] = await queryBuilder.getMany();

    usableFlows = usableFlows.map(({ flow, ...rest }) => ({
      ...rest,
      name: flow?.name ?? null,
    }));

    const flowIds: string[] = usableFlows.map((flow) => flow.id);

    let executionCounts = [];

    if (flowIds.length > 0) {
      executionCounts = await connection
        .createQueryBuilder(Execution, "execution")
        .select("COUNT(execution.id)", "count")
        .addSelect("execution.usableFlowId", "usableFlowId")
        .where("execution.usableFlowId IN (:...flowIds)", { flowIds })
        .groupBy("execution.usableFlowId")
        .getRawMany();
    }

    for (const flow of usableFlows) {
      const countData = executionCounts.find(
        (ec) => ec.usableFlowId === flow.id
      );
      flow.executionCount = countData ? parseInt(countData.count) : 0;
    }

    // fetch corresponding names for createdBy and lastUpdatedBy from user table and flow description from flow table
    const usableFlowsWithUserNames = await Promise.all(
      usableFlows.map(async (flow: UsableFlow) => {
        const createdByUser = await connection
          .createQueryBuilder(User, "user")
          .select(["user.username"])
          .where("user.id = :id", { id: flow.createdBy })
          .getOne();

        const lastUpdatedByUser = await connection
          .createQueryBuilder(User, "user")
          .select(["user.first_name", "user.last_name"])
          .where("user.id = :id", { id: flow.lastUpdatedBy })
          .getOne();

        const categoryNames =
          flow.category.length > 0
            ? await connection
                .createQueryBuilder(UsableFlowCategory, "category")
                .select(["category.name"])
                .where("category.id IN (:...ids)", { ids: flow.category })
                .getMany()
            : [];

        const toolNames =
          flow.tools.length > 0
            ? await connection
                .createQueryBuilder(UsableFlowTools, "tools")
                .select(["tools.name"])
                .where("tools.id IN (:...ids)", { ids: flow.tools })
                .getMany()
            : [];

        const getFullName = (user: User | null) => {
          if (!user) return "Unknown";
          const firstName = capitalizeFirstChar(user.first_name?.trim() ?? "");
          const lastName = capitalizeFirstChar(user.last_name?.trim() ?? "");
          return `${firstName} ${lastName}`.trim();
        };

        return {
          ...flow,
          creator: createdByUser?.username || "Unknown",
          updater: getFullName(lastUpdatedByUser) || "Unknown",
          updatedAt: flow.updatedAt || flow.createdAt,
          isDeleted: flow.isDeleted ?? false, // Default to false if not set
          isActive: flow.isActive ?? true, // Default
          description: flow.description || "No description available",
          categoryNames: categoryNames.map(
            (category: UsableFlowCategory) => category.name
          ),
          toolNames: toolNames.map((tool: UsableFlowTools) => tool.name),
          status: flow.status,
          templateName: flow.templateName,
          ChargeCodeStatus: flow.chargeCode,
        };
      })
    );

    const latestFlow = await connection
      .getRepository(UsableFlow)
      .createQueryBuilder("uf")
      .select(["uf.templateName"])
      .where("uf.isDeleted = false")
      .orderBy("uf.updatedAt", "DESC")
      .limit(1)
      .getOne();

    const latestUpdatedTemplateName = latestFlow?.templateName ?? null;
    let total = countResults.activePublishedCount;
    if (isAdmin) {
      total = countResults.totalCount;
    }

    return {
      message: parseInt(total) > 0 ? "Success" : "No records found",
      usableFlows: usableFlowsWithUserNames,
      total: parseInt(total),
      categoryCounts: categoryCountMap,
      latestUpdatedTemplateName,
      pageViewTotal: usableFlowsWithUserNames.length,
      totalCountWithoutPagination: totalCountWithoutPagination,
      counts: {
        publishedCount: parseInt(countResults.publishedCount),
        inDevelopmentCount: parseInt(countResults.inDevelopmentCount),
        activeCount: parseInt(countResults.activeCount),
        inActiveCount: parseInt(countResults.inActiveCount),
      },
    };
  }


   @Post("/allUsableFlows")
  async list_usable_flows(
    @Body()
    {
      skip,
      limit,
      isAdminScreen,
      searchTerm,
      categoryId,
      userId,
      sortField,
      sortOrder,
    }: {
      skip?: number;
      limit?: number;
      isAdminScreen: boolean;
      searchTerm?: string;
      categoryId?: string;
      userId: string;
      sortField: string;
      sortOrder: SortOrder;
    }
  ) {
    logger.info(
      "Listing all usable flows with skip: {}, limit: {}, searchTerm: {}, sortField: {}, sortOrder: {}",
      skip,
      limit,
      searchTerm,
      categoryId,
      isAdminScreen,
      sortField,
      sortOrder
    );
    try {
      const usableFlows = await this.flowService.listAllUsableFlows(
        skip,
        limit,
        userId,
        isAdminScreen,
        searchTerm,
        categoryId,
        sortField,
        sortOrder
      );
      if (!usableFlows) {
        throw new APIError("Failed to list usable flows", 500);
      }
      logger.info("Usable flows listed successfully");
      return usableFlows;
    } catch (error) {
      logger.error("Error listing usable flows: {}", error);
      throw new APIError("An unexpected error occurred", 500);
    }
  }
