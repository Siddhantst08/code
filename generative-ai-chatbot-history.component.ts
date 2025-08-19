class UsableFlowsResponse(BaseModel):
    message: str
    usableFlows: List[UsableFlowWithCreatorName]
    total: int
    pageViewTotal: int
    totalCountWithoutPagination: int
    latestUpdatedTemplateName: Optional[str]
    counts: Counts
    categoryCounts: Dict[str, Any]
