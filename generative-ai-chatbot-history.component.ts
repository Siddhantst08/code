    async def list_all_usable_flows(
        self,
        skip: int = 0,
        limit: int = 10,
        userId: str = None,
        isAdminScreen: bool = False,
        searchTerm: Optional[str] = None,
        categoryId: Optional[str] = None,
        sortField: Optional[str] = None,
        sortOrder: Optional[str] = None,
    ):
        async with self.session as session:
            # Get user details
            user_details = await session.execute(select(User).where(User.id == userId))
            user_details = user_details.scalar_one_or_none()

            if not user_details:
                logger.error("User not found with ID: %s", userId)
                raise HTTPException("User not found", 404)

            is_super_admin = user_details.is_superuser
            current_user_mail = user_details.email
            is_admin = str(isAdminScreen).lower() == "true"

            # Create aliases
            access_alias = aliased(UsableFlowAccess)
            flow_alias = aliased(Flow)

            # Main query for usable flows with specific columns
            query = (
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
                    flow_alias.name.label("name"),
                )
                .select_from(UsableFlow)
                .outerjoin(
                    access_alias,
                    and_(
                        access_alias.usableFlowId == UsableFlow.id,
                        access_alias.emails == current_user_mail,
                    ),
                )
                .outerjoin(flow_alias, flow_alias.id == UsableFlow.flowId)
                .where(UsableFlow.isDeleted == False)
            )

            # Apply non-admin filters
            if not is_admin:
                query = query.where(
                    UsableFlow.isActive == True,
                    UsableFlow.status == UsableFlowStatus.Published.value,
                )
            # Apply access restrictions for non-super admins
            if not is_super_admin:
                query = query.where(
                    or_(
                        UsableFlow.access == AccessType.Public.value,
                        and_(
                            UsableFlow.access == AccessType.Specific.value,
                            access_alias.id.isnot(None),
                        ),
                    )
                )

            # Search term filter
            if searchTerm and len(searchTerm) > 0:
                sanitized = sanitizeSafeText(searchTerm)
                query = query.where(UsableFlow.templateName.ilike(f"%{sanitized}%"))

            # Sorting
            allowed_execution_sort_fields = ["templateName", "updatedAt"]
            if (
                sortField
                and sortOrder
                and sortField in allowed_execution_sort_fields
                and sortOrder in ["asc", "desc"]
            ):
                logger.info(
                    "Applied custom sorting on usableFlow with 'usableFlow.%s %s'",
                    sortField,
                    sortOrder,
                )
                if sortOrder == "asc":
                    query = query.order_by(getattr(UsableFlow, sortField).asc())
                else:
                    query = query.order_by(getattr(UsableFlow, sortField).desc())
            else:
                query = query.order_by(UsableFlow.updatedAt.desc())

            # Pagination
            query = query.offset(skip).limit(limit)

            # Count query builder
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

            count_results_result = await session.execute(count_results_query)

            count_results_row = count_results_result.first()

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
            return {
                "message": "Success" if total > 0 else "No records found",
                "usableFlows": usable_flows_with_user_names,
                "total": total,
                "categoryCounts": category_count_map,
                "latestUpdatedTemplateName": latest_updated_template_name,
                "pageViewTotal": len(usable_flows_with_user_names),
                "totalCountWithoutPagination": total_count_without_pagination,
                "counts": {
                    "publishedCount": count_results["publishedCount"],
                    "inDevelopmentCount": count_results["inDevelopmentCount"],
                    "activeCount": count_results["activeCount"],
                    "inActiveCount": count_results["inActiveCount"],
                },
            }
