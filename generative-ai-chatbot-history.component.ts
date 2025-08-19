from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from db import get_db

router = APIRouter()

@router.post("/allUsableFlows")
async def list_usable_flows(
    skip: int = 0,
    limit: int = 10,
    userId: str = None,
    isAdminScreen: bool = False,
    searchTerm: str = None,
    categoryId: str = None,
    sortField: str = None,
    sortOrder: SortOrder = None,
    db: AsyncSession = Depends(get_db),
):
    try:
        return await list_all_usable_flows(
            db=db,
            skip=skip,
            limit=limit,
            userId=userId,
            isAdminScreen=isAdminScreen,
            searchTerm=searchTerm,
            categoryId=categoryId,
            sortField=sortField,
            sortOrder=sortOrder,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error listing flows: {str(e)}")
