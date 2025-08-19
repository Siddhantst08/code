
class UsableFlowWithCreatorName(BaseModel):
    id: str
    flowId: str
    templateName: str
    description: Optional[str]
    creator: str
    updater: str
    executionCount: int
    categoryNames: List[str]
    toolNames: List[str]
    status: str
    isActive: bool
    isDeleted: bool
