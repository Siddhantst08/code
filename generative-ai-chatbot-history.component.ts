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
                .where(UsableFlow.isDeleted == False)
            )

            # Apply same conditions to count query
            if not is_admin:
                count_query = count_query.where(
                    UsableFlow.isActive == True,
                    UsableFlow.status == UsableFlowStatus.Published.value,
                )

            if not is_super_admin:
                count_query = count_query.where(
                    or_(
                        UsableFlow.access == AccessType.Public.value,
                        and_(
                            UsableFlow.access == AccessType.Specific.value,
                            access_alias.id.isnot(None),
                        ),
                    )
                )

            if searchTerm and len(searchTerm) > 0:
                sanitized = sanitizeSafeText(searchTerm)
                count_query = count_query.where(
                    UsableFlow.templateName.ilike(f"%{sanitized}%")
                )

            total_count_without_pagination = 0
            if not is_admin:

                total_count_result = await session.execute(count_query)

                total_count_without_pagination = total_count_result.scalar() or 0

            # Get count results with aggregated data
            count_results_query = (
                select(
                    func.coalesce(
                        func.sum(
                            case(
                                (
                                    UsableFlow.status
                                    == UsableFlowStatus.Published.value,
                                    1,
                                ),
                                else_=0,
                            )
                        ),
                        0,
                    ).label("publishedCount"),
                    func.coalesce(
                        func.sum(
                            case(
                                (
                                    UsableFlow.status
                                    == UsableFlowStatus.InDevelopment.value,
                                    1,
                                ),
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
                                        UsableFlow.status
                                        == UsableFlowStatus.Published.value,
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
                .where(UsableFlow.isDeleted == False)
            )

            # Apply same conditions to count results query
            if not is_admin:
                count_results_query = count_results_query.where(
                    UsableFlow.isActive == True,
                    UsableFlow.status == UsableFlowStatus.Published.value,
                )

            if not is_super_admin:
                count_results_query = count_results_query.where(
                    or_(
                        UsableFlow.access == AccessType.Public.value,
                        and_(
                            UsableFlow.access == AccessType.Specific.value,
                            access_alias.id.isnot(None),
                        ),
                    )
                )

            if searchTerm and len(searchTerm) > 0:
                sanitized = sanitizeSafeText(searchTerm)
                count_results_query = count_results_query.where(
                    UsableFlow.templateName.ilike(f"%{sanitized}%")
                )

            print(count_results_query)
            count_results_result = await session.execute(count_results_query)

            count_results_row = count_results_result.first()
            print(count_results_row)

            count_results = {
                "publishedCount": count_results_row[0] if count_results_row else 0,
                "inDevelopmentCount": count_results_row[1] if count_results_row else 0,
                "activeCount": count_results_row[2] if count_results_row else 0,
                "inActiveCount": count_results_row[3] if count_results_row else 0,
                "activePublishedCount": (
                    count_results_row[4] if count_results_row else 0
                ),
            }

            if is_admin:
                count_results["totalCount"] = (
                    count_results["publishedCount"]
                    + count_results["inDevelopmentCount"]
                )

            # Category count
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
                .where(UsableFlow.isDeleted == False)
                .group_by("categoryId", UsableFlow.status)
            )

            # Apply same conditions to category count query
            if not is_admin:
                category_count_query = category_count_query.where(
                    UsableFlow.isActive == True,
                    UsableFlow.status == UsableFlowStatus.Published.value,
                )

            if not is_super_admin:
                category_count_query = category_count_query.where(
                    or_(
                        UsableFlow.access == AccessType.Public.value,
                        and_(
                            UsableFlow.access == AccessType.Specific.value,
                            access_alias.id.isnot(None),
                        ),
                    )
                )

            if searchTerm and len(searchTerm) > 0:
                sanitized = sanitizeSafeText(searchTerm)
                category_count_query = category_count_query.where(
                    UsableFlow.templateName.ilike(f"%{sanitized}%")
                )

            category_count_result = await session.execute(category_count_query)

            category_count_raw = category_count_result.all()

            category_count_map = {}
            for row in category_count_raw:
                categoryId, status, count = row
                if categoryId not in category_count_map:
                    category_count_map[categoryId] = {"statuses": {}}
                category_count_map[categoryId]["statuses"][status] = (
                    category_count_map[categoryId]["statuses"].get(status, 0) + count
                )

            # Apply category filter if needed
            if categoryId:
                query = query.where(UsableFlow.category.any(categoryId))
                count_query = count_query.where(UsableFlow.category.any(categoryId))

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
                    "name": result[19],
                }

                usable_flows.append(usable_flow_dict)

            flow_ids = [flow["id"] for flow in usable_flows]

            execution_counts = []
            if flow_ids:

                execution_counts_query = (
                    select(
                        Execution.usableFlowId, func.count(Execution.id).label("count")
                    )
                    .where(Execution.usableFlowId.in_(flow_ids))
                    .group_by(Execution.usableFlowId)
                )

                execution_counts_result = await session.execute(execution_counts_query)
                execution_counts = execution_counts_result.all()

            for flow in usable_flows:
                count_data = next(
                    (ec for ec in execution_counts if ec[0] == flow["id"]), None
                )
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
                    select(User.first_name, User.last_name).where(
                        User.id == flow["lastUpdatedBy"]
                    )
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

                usable_flows_with_user_names.append(
                    {
                        **flow,
                        "creator": created_by_user if created_by_user else "Unknown",
                        "updater": (
                            get_full_name(last_updated_by_user)
                            if last_updated_by_user
                            else "Unknown"
                        ),
                        "updatedAt": flow["updatedAt"] or flow["createdAt"],
                        "isDeleted": flow["isDeleted"] or False,
                        "isActive": flow["isActive"] or True,
                        "description": flow["description"]
                        or "No description available",
                        "categoryNames": category_names,
                        "toolNames": tool_names,
                        "status": flow["status"],
                        "templateName": flow["templateName"],
                        "ChargeCodeStatus": flow["chargeCode"],
                    }
                )

            # Get latest flow

            latest_flow_result = await session.execute(
                select(UsableFlow.templateName)
                .where(UsableFlow.isDeleted == False)
                .order_by(UsableFlow.updatedAt.desc())
                .limit(1)
            )

            latest_flow = latest_flow_result.scalar_one_or_none()

            latest_updated_template_name = latest_flow if latest_flow else None

            total = count_results["activePublishedCount"]

            if is_admin:
                total = count_results["totalCount"]
