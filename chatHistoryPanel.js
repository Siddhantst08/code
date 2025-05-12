import React, { useState, useEffect, useRef } from 'react';
import { Tooltip } from 'primereact/tooltip';
import { Toast } from 'primereact/toast';
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog';

const ChatHistoryPanel = ({
  chatHistoryLabelsData = [],
  totalRecords = 0,
  chatBotConfigurations = {},
  chatHistoryLoading = false,
  disableChatHistoryClick = false,
  blankSearchInput = false,
  botSessionId = '',
  onLoadMoreData,
  onCloseBotHistorypanel,
  onChatHistoryData,
  onGetChatHistoryLabels,
  onSendSaveData,
  onSearchQueries,
  onDeleteData,
  onDownloadData
}) => {
  // State
  const [pageNo, setPageNo] = useState(2);
  const [queryEditId, setQueryEditId] = useState(null);
  const [newQueryTitle, setNewQueryTitle] = useState('');
  const [closeHistoryBlock, setCloseHistoryBlock] = useState(true);
  const [categorizedData, setCategorizedData] = useState({
    today: [],
    yesterday: [],
    previous7Days: [],
    previous30Days: []
  });
  const [currentChatData, setCurrentChatData] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [showDisclaimerWindow, setShowDisclaimerWindow] = useState(true);
  const [searchValue, setSearchValue] = useState('');
  const [isChatHistoryDisabled, setIsChatHistoryDisabled] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);

  // Refs
  const disclaimerWindowRef = useRef(null);
  const toastRef = useRef(null);

  // Configurations with defaults
  const {
    historyActionButtons = [],
    chatHistorySearchBarPlaceholderText = 'Search your threads...',
    querySplitLength = 25,
    querySaveErrorMessage = 'Error while saving your query',
    queryDeleteErrorMessage = 'Error while deleting your query',
    inputFieldValidationMessage = 'Input should not be blank',
    chatHistoryDateFormat = 'dd MMM',
    noRecordFoundMessageText = 'No Chat History Data Found',
    searchTriggerMinCharLimit = 2,
    loadMoreButtonText = 'Load more chats',
    windowTitleMessage = 'Chat History',
    chatHistoryClickDisabledMessage = 'Click disabled while loading response',
    queryRenameSuccessMessage = 'Query Renamed Successfully',
    queryDeleteSuccessMessage = 'Query Deleted SuccessFully',
    queryDeleteConfirmationMessage = 'Do you want to delete query title?',
    queryDeleteConfirmationHeaderMessage = 'Chat History Delete Confirmation',
    chatHistoryAllThreadListView = false,
    chatHistoryAllThreadListViewTitleMessage = 'Previous 7 Days',
    chatHistoryshowDisclaimerWindow = true,
    chatHistorySearchVisible = true,
    chatHistoryDisclaimerText = "Filters are applied to new messages only. Historical messages may not reflect the current filter settings.",
    inputQueryBoxCharacterLimit = 100,
    chatHistoryEditFieldCharacterLimitValidationMessage = 'Character limit exceeded'
  } = chatBotConfigurations;

  // Effects
  useEffect(() => {
    setIsChatHistoryDisabled(blankSearchInput);
  }, [blankSearchInput]);

  useEffect(() => {
    if (chatHistoryLabelsData) {
      const dataWithLocalTime = chatHistoryLabelsData.map(item => ({
        ...item,
        localTime: convertToLocalTime(item.created)
      }));
      setCurrentChatData(dataWithLocalTime);
      convertAndCategorizeData(dataWithLocalTime);
    }
  }, [chatHistoryLabelsData]);

  useEffect(() => {
    if (botSessionId) {
      setSelectedIndex(botSessionId);
    }
  }, [botSessionId]);

  useEffect(() => {
    setShowTooltip(chatBotConfigurations.showTooltip || false);
  }, [chatBotConfigurations]);

  // Helper functions
  const convertToLocalTime = (gmtDateString) => {
    const gmtDate = new Date(gmtDateString);
    const localDate = new Date(gmtDate.getTime() - (gmtDate.getTimezoneOffset() * 60000));
    
    const options = {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    };
    return new Intl.DateTimeFormat('en-US', options).format(localDate);
  };

  const convertAndCategorizeData = (data) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const lastWeek = new Date(today);
    lastWeek.setDate(today.getDate() - 7);
    const lastMonth = new Date(today);
    lastMonth.setDate(today.getDate() - 30);

    const categorized = {
      today: [],
      yesterday: [],
      previous7Days: [],
      previous30Days: []
    };

    data.forEach(item => {
      const localTimestamp = new Date(item.localTime);
      if (!chatHistoryAllThreadListView) {
        if (localTimestamp >= today) {
          categorized.today.push({ ...item, localTimestamp });
        } else if (localTimestamp >= yesterday && localTimestamp < today) {
          categorized.yesterday.push({ ...item, localTimestamp });
        } else {
          categorized.previous7Days.push({ ...item, localTimestamp });
        }
      } else {
        item.localTimestamp = localTimestamp;
      }
    });

    setCategorizedData(categorized);
  };

  const checkDropdownButtonVisibility = (buttons) => {
    return buttons && buttons.length > 0 && buttons.some(item => item.isVisible);
  };

  // Event handlers
  const handleClick = (action, history) => {
    if (action.isVisible) {
      const actionTitle = action.title.toLowerCase();
      switch (actionTitle) {
        case 'rename':
          renameQuery(history);
          break;
        case 'delete':
          onHistoryDelete(history.id);
          break;
        case 'download':
          onDownloadHistory(history);
          break;
        default:
          break;
      }
    }
  };

  const renameQuery = (data) => {
    setCloseHistoryBlock(true);
    setQueryEditId(data.id);
    if (data) {
      setNewQueryTitle(data.query);
    }
  };

  const onDownloadHistory = (history) => {
    onDownloadData(history);
  };

  const saveEditQuery = (Query, Id) => {
    if (Query.trim() === '' || Query === undefined || Query === null) {
      showWarn('warn', 'Warning', inputFieldValidationMessage);
    } else if (Query.length > inputQueryBoxCharacterLimit) {
      showWarn('warn', 'Warning', chatHistoryEditFieldCharacterLimitValidationMessage);
    } else {
      const updateQuery = {
        Id: Id,
        Query: Query.trim()
      };

      if (updateQuery && updateQuery.Id != null && updateQuery.Query !== undefined) {
        const model = {
          sessionId: Id,
          query: Query.trim(),
        };
        
        // In a real implementation, you would call your API here
        // For now, we'll simulate a successful response
        setTimeout(() => {
          showWarn('success', 'Success', queryRenameSuccessMessage);
          onSendSaveData(updateQuery);
          setQueryEditId(null);
          setNewQueryTitle('');
        }, 500);
      } else {
        showWarn('error', 'Error', querySaveErrorMessage);
      }
    }
  };

  const onHistoryDelete = (Id) => {
    confirmDialog({
      message: queryDeleteConfirmationMessage,
      header: queryDeleteConfirmationHeaderMessage,
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        const deleteQuery = { Id };
        if (deleteQuery && deleteQuery.Id != null) {
          // In a real implementation, you would call your API here
          // For now, we'll simulate a successful response
          setTimeout(() => {
            showWarn('success', 'Success', queryDeleteSuccessMessage);
            onDeleteData(deleteQuery);
          }, 500);
        } else {
          showWarn('error', 'Error', queryDeleteErrorMessage);
        }
      },
      reject: () => {
        // Do nothing on reject
      }
    });
  };

  const showWarn = (severity, summary, warningMessage) => {
    toastRef.current.show({
      severity,
      summary,
      detail: warningMessage,
      life: 3000
    });
  };

  const showChatHistory = (historydata) => {
    if (!disableChatHistoryClick) {
      onChatHistoryData(historydata);
    } else {
      showWarn('warn', 'Warning', chatHistoryClickDisabledMessage);
    }
  };

  const loadMoreChats = () => {
    onLoadMoreData(pageNo);
    setPageNo(prev => prev + 1);
  };

  const onSearch = (query) => {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length && trimmedQuery.length >= searchTriggerMinCharLimit) {
      onSearchQueries(trimmedQuery);
    } else if (query.length === 0) {
      onSearchQueries('');
      setPageNo(2);
    }
  };

  const closeDisclaimerWindow = () => {
    setShowDisclaimerWindow(false);
  };

  const clearSearch = () => {
    setSearchValue('');
    onSearchQueries('');
  };

  // Render helpers
  const renderEditInputWrapper = (history) => {
    if (history.id === queryEditId && closeHistoryBlock) {
      return (
        <div className="history-edit-input-wrapper">
          <input
            type="text"
            value={newQueryTitle}
            onChange={(e) => setNewQueryTitle(e.target.value)}
            className="form-control"
            id="queryName"
          />
          <div className="editHistoryActionWrapper">
            <div className="editHistorySaved" onClick={() => saveEditQuery(newQueryTitle, history.id)}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M14.8378 3.18476C15.0635 3.42114 15.0523 3.79338 14.8129 4.01617L5.36454 12.8078C5.08171 13.071 4.63775 13.0629 4.36497 12.7896L1.17138 9.5896C0.940458 9.35822 0.943251 8.98583 1.17762 8.75785C1.41199 8.52986 1.78918 8.53262 2.02011 8.76401L4.88654 11.6362L13.9956 3.16015C14.2351 2.93735 14.6121 2.94837 14.8378 3.18476Z" fill="#3265AA"/>
              </svg>
            </div>
            <div className="editHistoryCancel" onClick={() => setCloseHistoryBlock(false)}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2.13107 2.24194L2.18306 2.18306C2.40836 1.95776 2.76288 1.94042 3.00806 2.13107L3.06694 2.18306L7 6.11562L10.9331 2.18306C11.1771 1.93898 11.5729 1.93898 11.8169 2.18306C12.061 2.42714 12.061 2.82286 11.8169 3.06694L7.88438 7L11.8169 10.9331C12.0422 11.1584 12.0596 11.5129 11.8689 11.7581L11.8169 11.8169C11.5916 12.0422 11.2371 12.0596 10.9919 11.8689L10.9331 11.8169L7 7.88438L3.06694 11.8169C2.82286 12.061 2.42714 12.061 2.18306 11.8169C1.93898 11.5729 1.93898 11.1771 2.18306 10.9331L6.11562 7L2.18306 3.06694C1.95776 2.84164 1.94042 2.48712 2.13107 2.24194L2.18306 2.18306L2.13107 2.24194Z" fill="#3265AA"/>
              </svg>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  const renderHistoryItem = (history, ind) => {
    const truncatedQuery = history.query.length > querySplitLength 
      ? `${history.query.slice(0, querySplitLength)}...` 
      : history.query;

    return (
      <li key={`${history.id}-${ind}`}>
        {renderEditInputWrapper(history)}
        <div 
          className={`history-title-wrapper ${selectedIndex === history.id ? 'active' : ''}`}
          data-pr-tooltip={showTooltip && history.query.length > querySplitLength ? history.query : ''}
          data-pr-position="left"
          data-pr-class="chatbotqueryTooltip"
        >
          <span 
            className="chatHistoryQuery" 
            onClick={() => showChatHistory(history)}
          >
            {truncatedQuery}
          </span>
          {checkDropdownButtonVisibility(historyActionButtons) && (
            <div className="history-action-wrapper">
              <span>{new Date(history.localTimestamp).toLocaleDateString('en-US', {
                day: '2-digit',
                month: 'short'
              })}</span>
              <div className="action-wrapper">
                <svg width="2" height="10" viewBox="0 0 2 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect width="2" height="2" fill="black"/>
                  <rect y="4" width="2" height="2" fill="black"/>
                  <rect y="8" width="2" height="2" fill="black"/>
                </svg>
              </div>
            </div>
          )}
          {!disableChatHistoryClick && checkDropdownButtonVisibility(historyActionButtons) && (
            <ul className="chat-history-dropdown dropdown-menu">
              {historyActionButtons.map((action, idx) => (
                action.isVisible && (
                  <li key={idx} onClick={() => handleClick(action, history)}>
                    {action.title}
                  </li>
                )
              ))}
            </ul>
          )}
        </div>
      </li>
    );
  };

  const renderBifurcatedView = () => (
    <ul>
      {categorizedData.today.length > 0 && (
        <li className="chat-history-data-heading data-heading-today">Today</li>
      )}
      {categorizedData.today.map((history, ind) => renderHistoryItem(history, ind))}

      {categorizedData.yesterday.length > 0 && (
        <li className="chat-history-data-heading data-heading-yesterday">Yesterday</li>
      )}
      {categorizedData.yesterday.map((history, ind) => renderHistoryItem(history, ind))}

      {categorizedData.previous7Days.length > 0 && (
        <li className="chat-history-data-heading data-heading-p-seven-days">Last 7 Days</li>
      )}
      {categorizedData.previous7Days.map((history, ind) => renderHistoryItem(history, ind))}
    </ul>
  );

  const renderListView = () => (
    <ul>
      <li className="chat-history-data-heading data-heading-today">{chatHistoryAllThreadListViewTitleMessage}</li>
      {currentChatData.map((history, ind) => renderHistoryItem(history, ind))}
    </ul>
  );

  // Calculate dynamic height
  const calculateChatQueriesWrapperHeight = () => {
    if (chatHistorySearchVisible && showDisclaimerWindow) {
      return `calc(100vh - 100px - ${disclaimerWindowRef.current?.offsetHeight || 56}px)`;
    } else if (!chatHistorySearchVisible && showDisclaimerWindow) {
      return `calc(100vh - 42px - ${disclaimerWindowRef.current?.offsetHeight || 56}px)`;
    } else if (chatHistorySearchVisible && !showDisclaimerWindow) {
      return `calc(100vh - 92px)`;
    } else {
      return `calc(100vh - 42px)`;
    }
  };

  return (
    <div className="chat-history-panel">
      <Toast ref={toastRef} position="bottom-right" />
      <ConfirmDialog />
      <Tooltip target=".history-title-wrapper" />

      {/* Title Wrapper */}
      <div className="panel-title-wrapper">
        <div className="slider-panel-title">
          <h4>{windowTitleMessage}</h4>
        </div>
        <div className="closebtn" onClick={() => onCloseBotHistorypanel(false)}>
          <svg width="14" height="13" viewBox="0 0 14 13" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M7.82496 6.44559L12.845 1.42559C13.0016 1.26898 13.0896 1.05657 13.0896 0.835093C13.0896 0.613613 13.0016 0.401203 12.845 0.244593C12.6883 0.0879828 12.4759 1.65016e-09 12.2545 0C12.033 -1.65016e-09 11.8206 0.0879828 11.664 0.244593L6.64396 5.26359L1.62396 0.244593C1.46735 0.0879828 1.25494 0 1.03346 0C0.811977 0 0.599568 0.0879828 0.442957 0.244593C0.286347 0.401203 0.198364 0.613613 0.198364 0.835093C0.198364 1.05657 0.286347 1.26898 0.442957 1.42559L5.46296 6.44559L0.442957 11.4636C0.365412 11.5411 0.303899 11.6332 0.261932 11.7345C0.219965 11.8358 0.198364 11.9444 0.198364 12.0541C0.198364 12.1638 0.219965 12.2724 0.261932 12.3737C0.303899 12.475 0.365412 12.567 0.442957 12.6446C0.520503 12.7221 0.612563 12.7837 0.713881 12.8256C0.815199 12.8676 0.923791 12.8892 1.03346 12.8892C1.14312 12.8892 1.25172 12.8676 1.35303 12.8256C1.45435 12.7837 1.54641 12.7221 1.62396 12.6446L6.64396 7.62459L11.664 12.6446C11.7415 12.7222 11.8336 12.7838 11.9349 12.8258C12.0363 12.8678 12.1449 12.8895 12.2546 12.8895C12.3643 12.8896 12.473 12.868 12.5743 12.8261C12.6757 12.7841 12.7678 12.7226 12.8455 12.6451C12.9231 12.5675 12.9846 12.4755 13.0267 12.3741C13.0687 12.2728 13.0904 12.1642 13.0904 12.0544C13.0905 11.9447 13.0689 11.8361 13.0269 11.7347C12.985 11.6333 12.9235 11.5412 12.846 11.4636L7.82496 6.44559Z" fill="black"/>
          </svg>
        </div>
      </div>

      {/* Disclaimer Text */}
      {showDisclaimerWindow && (
        <div 
          ref={disclaimerWindowRef}
          className={`disclaimer-window ${isChatHistoryDisabled ? 'btn-disabled' : ''}`}
          style={{ marginBottom: !chatHistorySearchVisible ? '10px' : '0' }}
        >
          <div className="disclaimer-text">
            {chatHistoryDisclaimerText}
          </div>
          <div className="closebtnDisclaimer" onClick={closeDisclaimerWindow}>
            <svg width="10" height="10" viewBox="0 0 14 13" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M7.82496 6.44559L12.845 1.42559C13.0016 1.26898 13.0896 1.05657 13.0896 0.835093C13.0896 0.613613 13.0016 0.401203 12.845 0.244593C12.6883 0.0879828 12.4759 1.65016e-09 12.2545 0C12.033 -1.65016e-09 11.8206 0.0879828 11.664 0.244593L6.64396 5.26359L1.62396 0.244593C1.46735 0.0879828 1.25494 0 1.03346 0C0.811977 0 0.599568 0.0879828 0.442957 0.244593C0.286347 0.401203 0.198364 0.613613 0.198364 0.835093C0.198364 1.05657 0.286347 1.26898 0.442957 1.42559L5.46296 6.44559L0.442957 11.4636C0.365412 11.5411 0.303899 11.6332 0.261932 11.7345C0.219965 11.8358 0.198364 11.9444 0.198364 12.0541C0.198364 12.1638 0.219965 12.2724 0.261932 12.3737C0.303899 12.475 0.365412 12.567 0.442957 12.6446C0.520503 12.7221 0.612563 12.7837 0.713881 12.8256C0.815199 12.8676 0.923791 12.8892 1.03346 12.8892C1.14312 12.8892 1.25172 12.8676 1.35303 12.8256C1.45435 12.7837 1.54641 12.7221 1.62396 12.6446L6.64396 7.62459L11.664 12.6446C11.7415 12.7222 11.8336 12.7838 11.9349 12.8258C12.0363 12.8678 12.1449 12.8895 12.2546 12.8895C12.3643 12.8896 12.473 12.868 12.5743 12.8261C12.6757 12.7841 12.7678 12.7226 12.8455 12.6451C12.9231 12.5675 12.9846 12.4755 13.0267 12.3741C13.0687 12.2728 13.0904 12.1642 13.0904 12.0544C13.0905 11.9447 13.0689 11.8361 13.0269 11.7347C12.985 11.6333 12.9235 11.5412 12.846 11.4636L7.82496 6.44559Z" fill="black"/>
            </svg>
          </div>
        </div>
      )}

      {/* Search Wrapper */}
      {chatHistorySearchVisible && (
        <div className={`chat-history-search-wrapper ${isChatHistoryDisabled ? 'btn-disabled' : ''}`}>
          <input
            type="text"
            placeholder={chatHistorySearchBarPlaceholderText}
            name="chatSearch"
            value={searchValue}
            onChange={(e) => {
              setSearchValue(e.target.value);
              onSearch(e.target.value);
            }}
            className="form-control"
          />
        </div>
      )}

      {/* Queries Results */}
      <div className={isChatHistoryDisabled ? 'btn-disabled' : ''}>
        <div 
          className={`chat-queries-wrapper scrollbar ${totalRecords > currentChatData.length ? 'loadMoreVisible' : ''}`}
          style={{ height: calculateChatQueriesWrapperHeight() }}
        >
          {chatHistoryAllThreadListView ? renderListView() : renderBifurcatedView()}

          {currentChatData.length === 0 && !chatHistoryLoading && (
            <div className="chatHistory-no-record-found-wrapper">
              <div className="no-data-found">
                <p>{noRecordFoundMessageText}</p>
              </div>
            </div>
          )}

          {chatHistoryLoading && (
            <div className="loader-wrapper">
              <div className="page-loader">
                <div className="loader-pulse">
                  <div></div>
                  <div></div>
                  <div></div>
                  <div></div>
                  <div></div>
                </div>
                <div className="loader_text">Loading</div>
              </div>
            </div>
          )}

          {totalRecords > currentChatData.length && currentChatData.length > 0 && (
            <div className="load-more-wrapper">
              <a className="load-more-button" onClick={loadMoreChats}>
                {loadMoreButtonText}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatHistoryPanel;
