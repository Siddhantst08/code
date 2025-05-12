import { Component, OnInit, Output, EventEmitter, ElementRef, Renderer2, Input, OnChanges, SimpleChanges, OnDestroy, ViewChild, AfterViewInit } from '@angular/core';
//import { BotHistoryService } from './bot-history.service';
import { HttpService } from 'src/app/core/services/http.service';
import { deleteQuery, updateQuery, queryActionButtons } from '../generative-ai-chatbot-history/generative-ai-chatbot-history.model';
import { MessageService } from 'primeng/api';
//import { GlobalConfig} from 'src/app/global/global.config';
import { ConfirmationService } from 'primeng/api';
import { FormControl } from '@angular/forms';
import { Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { ApiConfig } from 'src/app/core/config/api-config';

@Component({
  selector: 'app-generative-ai-chatbot-history',
  templateUrl: './generative-ai-chatbot-history.component.html',
  styleUrls: ['./generative-ai-chatbot-history.component.css'],
  providers: [ConfirmationService]
})
export class GenerativeAiChatbotHistoryComponent implements OnInit,OnChanges, AfterViewInit, OnDestroy {

    @Output() loadMoreData = new EventEmitter();
    @Output() closeBotHistorypanel = new EventEmitter();
    @Output() chatHistoryData = new EventEmitter();
    @Output() getChatHistoryLabels = new EventEmitter();
    @Output() sendSaveData = new EventEmitter();
    @Output() searchQueries = new EventEmitter();
    @Output() deleteData = new EventEmitter();
    @Output() downloadData = new EventEmitter();
  
    @Input() chatHistoryLabelsData: any[];
    @Input() totalRecords;
    @Input() chatBotConfigurations: any;
    @Input() chatHistoryLoading: boolean;
    @Input() disableChatHistoryClick: boolean;
    @Input() blankSearchInput:boolean;
    @Input() botSessionId: string;
    currentConfigurations: {};
    historyActionButtons: queryActionButtons[];
    pageNo: number = 2;
  
    queryEditId: number;
    newQueryTitle: string;
    closeHistoryBlock: boolean = true;
    categorizedData = {
      today: [],
      yesterday: [],
      previous7Days: [],
      previous30Days: []
    };
    updateQuery:updateQuery = {
      Id: '',
      Query: ''
    };
    deleteQuery:deleteQuery = {
      Id: ''
    };
  
    querySplitLength: number;
    chatHistorySearchBarPlaceholderText: string;
    querySaveErrorMessage: string;
    queryDeleteErrorMessage: string;
    inputFieldValidationMessage: string;
    chatHistoryDateFormat: string;
    searchTriggerMinCharLimit: number;
    noRecordFoundMessageText: string;
    loadMoreButtonText: string;
    windowTitleMessage: string;
    chatHistoryClickDisabled: string;
    checkDropdownItem: boolean;
    queryRenameSuccessMessage: string;
    queryDeleteSuccessMessage: string;
    queryDeleteConfirmationMessage: string;
    queryDeleteConfirmationHeaderMessage: string;
    allThreadListView: boolean;
    allThreadListViewTitleMessage: string;
    currentChatData:any[] = [];
    selectedIndex: number = -1;
    showDisclaimerWindow: boolean = true;
    @ViewChild('disclaimerWindow') disclaimerWindow: ElementRef;
    disclaimerWindowHeight: number;
    searchVisible: boolean;
    chatQueriesWrapperHeight: string;
    disclaimerText: string;
    searchControl = new FormControl('');
    searchCtrlSub: Subscription;
     action: queryActionButtons;
     isChatHistoryDisabled:boolean;
     showTooltip:boolean;
     inputQueryBoxCharacterLimit:number;
     chatHistoryEditFieldCharacterLimitValidationMessage:any;
    constructor(private service: HttpService, private element: ElementRef,
      private renderer: Renderer2, private messageService: MessageService,
      private confirmationService: ConfirmationService) {
      this.searchCtrlSub = this.searchControl.valueChanges.pipe(
        debounceTime(400),
        distinctUntilChanged((prev, curr)=> {
          const value = curr.trim();
          return value && prev.trim() === value
        })
      ).subscribe(newValue =>
        this.onSearch(newValue)
      );
    }
  
    ngOnDestroy(): void {
      this.searchCtrlSub.unsubscribe()
    }
  
    ngOnChanges(changes: SimpleChanges): void {
      
      let chatBotConfigurations = changes['chatBotConfigurations'];
      if (chatBotConfigurations != undefined && chatBotConfigurations.currentValue != undefined && chatBotConfigurations.currentValue != "") {
        if(chatBotConfigurations.currentValue ) {
          this.currentConfigurations = chatBotConfigurations.currentValue;
          this.historyActionButtons = chatBotConfigurations.currentValue.historyActionButtons ? chatBotConfigurations.currentValue.historyActionButtons : this.historyActionButtons;
          this.checkDropdownButtonVisibility(this.historyActionButtons);
          this.chatHistorySearchBarPlaceholderText = chatBotConfigurations.currentValue.chatHistorySearchBarPlaceholderText ? chatBotConfigurations.currentValue.chatHistorySearchBarPlaceholderText : 'Search your threads...';
          // Chat History Strip Length
          let stripLength = chatBotConfigurations.currentValue.chatHistoryQuerySplitLength;
          if(stripLength > 0 && stripLength != null && stripLength != undefined) {
            this.querySplitLength = stripLength;
          } else {
            this.querySplitLength = 25;
          }
  
          // Chat History Input Validation
          this.querySaveErrorMessage = chatBotConfigurations.currentValue.chatHistoryQuerySaveErrorMessage ? chatBotConfigurations.currentValue.chatHistoryQuerySaveErrorMessage : 'Error while saving your query';
          this.queryDeleteErrorMessage = chatBotConfigurations.currentValue.chatHistoryQueryDeleteErrorMessage ? chatBotConfigurations.currentValue.chatHistoryQueryDeleteErrorMessage : 'Error while deleting your query';
          this.inputFieldValidationMessage = chatBotConfigurations.currentValue.chatHistoryInputFieldValidationMessage ? chatBotConfigurations.currentValue.chatHistoryInputFieldValidationMessage : 'Input should not be blank';
          this.chatHistoryDateFormat = chatBotConfigurations.currentValue.chatHistoryDateFormat ? chatBotConfigurations.currentValue.chatHistoryDateFormat : 'dd MMM';
          this.noRecordFoundMessageText = chatBotConfigurations.currentValue.chatHistoryNoRecordFoundMessage ? chatBotConfigurations.currentValue.chatHistoryNoRecordFoundMessage : 'No Chat History Data Found';
          this.searchTriggerMinCharLimit = chatBotConfigurations.currentValue.chatHistorySearchTriggerMinCharLimit ? chatBotConfigurations.currentValue.chatHistorySearchTriggerMinCharLimit : 2;
          this.loadMoreButtonText = chatBotConfigurations.currentValue.chatHistoryLoadMoreButtonText ? chatBotConfigurations.currentValue.chatHistoryLoadMoreButtonText : 'Load more chats';
          this.windowTitleMessage = chatBotConfigurations.currentValue.chatHistoryWindowTitleMessage ? chatBotConfigurations.currentValue.chatHistoryWindowTitleMessage : 'Chat History';
          this.chatHistoryClickDisabled = chatBotConfigurations.currentValue.chatHistoryClickDisabledMessage ? chatBotConfigurations.currentValue.chatHistoryClickDisabledMessage : 'Click disabled while loading response';
          this.queryRenameSuccessMessage = chatBotConfigurations.currentValue.chatHistoryQueryRenameSuccessMessage ? chatBotConfigurations.currentValue.chatHistoryQueryRenameSuccessMessage : 'Query Renamed Successfully';
          this.queryDeleteSuccessMessage = chatBotConfigurations.currentValue.chatHistoryQueryDeleteSuccessMessage ? chatBotConfigurations.currentValue.chatHistoryQueryDeleteSuccessMessage : 'Query Deleted SuccessFully';
          this.queryDeleteConfirmationMessage = chatBotConfigurations.currentValue.chatHistoryQueryDeleteConfirmationMessage ? chatBotConfigurations.currentValue.chatHistoryQueryDeleteConfirmationMessage : 'Do you want to delete query title ?'
          this.queryDeleteConfirmationHeaderMessage = chatBotConfigurations.currentValue.chatHistoryQueryDeleteHeaderMessage ? chatBotConfigurations.currentValue.chatHistoryQueryDeleteHeaderMessage : 'Chat History Delete Confirmation';
          this.allThreadListView = chatBotConfigurations.currentValue.chatHistoryAllThreadListView;
          this.allThreadListViewTitleMessage = chatBotConfigurations.currentValue.chatHistoryAllThreadListViewTitleMessage ? chatBotConfigurations.currentValue.chatHistoryAllThreadListViewTitleMessage : 'Previous 7 Days';
          this.showDisclaimerWindow = chatBotConfigurations.currentValue.chatHistoryshowDisclaimerWindow;
          this.searchVisible = chatBotConfigurations.currentValue.chatHistorySearchVisible;
          this.disclaimerText = chatBotConfigurations.currentValue.chatHistoryDisclaimerText ? chatBotConfigurations.currentValue.chatHistoryDisclaimerText : "Filters are applied to new messages only. Historical messages may not reflect the current filter settings.";
          this.showTooltip=chatBotConfigurations.currentValue.showTooltip? chatBotConfigurations.currentValue.showTooltip: false;
          this.inputQueryBoxCharacterLimit=chatBotConfigurations.currentValue.inputQueryBoxCharacterLimit;
          this.chatHistoryEditFieldCharacterLimitValidationMessage=chatBotConfigurations.currentValue.chatHistoryEditFieldCharacterLimitValidationMessage;
        }
      }
      let chatData = changes['chatHistoryLabelsData'];
      if(chatData != undefined && chatData.currentValue != undefined) {
        this.currentChatData = chatData.currentValue;
        this.currentChatData.map((item)=>{
          item.localTime = this.convertToLocalTime(item.created)
        })
        this.convertAndCategorizeData();
        
      }
  
      let botSessionId = changes['botSessionId'];
      if(botSessionId != undefined && botSessionId.currentValue != undefined) {
        this.selectedIndex = botSessionId.currentValue;
      }
      this.isChatHistoryDisabled=this.blankSearchInput;
    }
    checkDropdownButtonVisibility(historyActionButtons: queryActionButtons[]) {
      if(historyActionButtons && historyActionButtons.length > 0){
        this.checkDropdownItem = historyActionButtons.some(item => item.isVisible);
      }
    }
  
    ngOnInit(): void {}
  
    ngAfterViewInit() {
      this.updateDisclaimerWindowHeight();
      setTimeout(() => {
        this.updateHeight();
      }, 0);
      
    }
  
    updateDisclaimerWindowHeight() {
      if(this.disclaimerWindow) {
        this.disclaimerWindowHeight = this.disclaimerWindow.nativeElement.offsetHeight;
      }
    }
  
    updateHeight() {
      if(this.searchVisible && this.showDisclaimerWindow) {
        if(this.disclaimerWindowHeight) {
          this.chatQueriesWrapperHeight = `calc(100vh - 100px - ${this.disclaimerWindowHeight}px)`; // added 15 bcz we have added margin of 15px
        } else {
          this.chatQueriesWrapperHeight = `calc(100vh - 160px - 56px)`;
        }
      } else if(!this.searchVisible && this.showDisclaimerWindow) {
          if(this.disclaimerWindowHeight) {
            this.chatQueriesWrapperHeight = `calc(100vh - 42px - ${this.disclaimerWindowHeight}px)`
          } else {
            this.chatQueriesWrapperHeight = `calc(100vh - 42px - 56px)`;
          }
      } else if(this.searchVisible && !this.showDisclaimerWindow) {
        this.chatQueriesWrapperHeight = `calc(100vh - 92px)`;
      } else {
        this.chatQueriesWrapperHeight = `calc(100vh - 42px)`;
      }
    }
  
  
  
    convertToLocalTime(gmtDateString: string): string {
      const gmtDate = new Date(gmtDateString);
      const localDate = new Date(gmtDate.getTime() - (gmtDate.getTimezoneOffset() * 60000));
      
      const options: Intl.DateTimeFormatOptions = {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      };
      return new Intl.DateTimeFormat('en-US', options).format(localDate);
    }
  
    
  
    convertAndCategorizeData() {
      // Get Current Date
      const now = new Date();
  
      // Get Today
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
      // Get Yesterday
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
  
      // Get Lastweek
      const lastWeek = new Date(today);
      lastWeek.setDate(today.getDate() - 7);
      
      // Get Last Month
      const lastMonth = new Date(today);
      lastMonth.setDate(today.getDate() - 30);
      this.categorizedData = {
        today: [],
        yesterday: [],
        previous7Days: [],
        previous30Days: []
      };
      this.currentChatData.forEach(item => {
        // Convert the item.created from GMT to local timezone
        const localTimestamp = new Date(item.localTime);
        if(this.allThreadListView == false) {
          if (localTimestamp >= today) {
            this.categorizedData.today.push({ ...item, localTimestamp });
          } 
          else if (localTimestamp >= yesterday && localTimestamp < today) {
            this.categorizedData.yesterday.push({ ...item, localTimestamp });
          }else{
            this.categorizedData.previous7Days.push({ ...item, localTimestamp });
          } 
          /*else if (localTimestamp >= lastWeek && localTimestamp < yesterday) {
            this.categorizedData.previous7Days.push({ ...item, localTimestamp });
          } 
          else {
            this.categorizedData.previous30Days.push({ ...item, localTimestamp });
          }*/
        } else {
          item.localTimestamp = localTimestamp;
        }
        
      });
    }
  
    closeBotHistory(data) {
      this.closeBotHistorypanel.emit(data);
    }
  
    handleClick(action, history) {
      if(action.isVisible == true) {
        let actionTitle = action.title.toLowerCase();
        switch(actionTitle) {
          case 'rename':
            this.renameQuery(history);
            break;
          case 'delete':
            this.onHistoryDelete(history.id);
            break;
            case 'download':
              this.onDownloadHistory(history);
              break;
        }
      }
    }
    
    renameQuery(data) {
      this.closeHistoryBlock = true;
      this.queryEditId = data.id;
      if(data) {
        this.newQueryTitle = data.query;
      }
    }
  
    onDownloadHistory(history){
      this.downloadData.emit(history)
    }
    
    saveEditQuery(Query:string,Id:string ) {
      this.chatHistoryLoading = true;
      if(Query.trim() == '' || Query == undefined || Query == null) {
        this.showWarn('warn', 'Warning', this.inputFieldValidationMessage)
      }else if(Query.length > this.inputQueryBoxCharacterLimit){
        this.showWarn('warn', 'Warning', this.chatHistoryEditFieldCharacterLimitValidationMessage)
      }
       else {
      this.updateQuery.Id = Id;   
      this.updateQuery.Query = Query.trim();
      if(this.updateQuery && this.updateQuery.Id != null && this.updateQuery.Query != undefined) {
        let model: any = {
          sessionId: Id,
          query: Query.trim(),
        };
        let api: any = ApiConfig.updateChatBotHistoryDataApi;
        this.service.post(api,model).subscribe(res => {
          if(res.result) {
            this.showWarn('success', 'Success', this.queryRenameSuccessMessage);
            this.chatHistoryLoading = false;
            this.sendSaveData.emit(this.updateQuery);
            this.queryEditId = null;
            this.newQueryTitle = '';
          } else {
            this.showWarn('error', 'Error', this.querySaveErrorMessage)
            this.chatHistoryLoading = false;
          }
        })
      } else {
        this.showWarn('error', 'Error', this.querySaveErrorMessage)
         this.chatHistoryLoading = false;
      }
      }
    }
  
    onHistoryDelete(Id:string) {
      this.deleteQuery.Id = Id;  
      if(this.deleteQuery && this.deleteQuery.Id != null) {
        this.confirmationService.confirm({
          message: this.queryDeleteConfirmationMessage,
          accept: () => {
            this.chatHistoryLoading = true;
            let api: any = ApiConfig.updateChatBotHistoryDataApi;
            let model: any = {
              sessionId: Id,
              query: null,
            };
            this.service.post(api, model).subscribe(res => {
              if(res.result) {
                this.showWarn('success', 'Success', this.queryDeleteSuccessMessage);
                this.deleteData.emit(this.deleteQuery);
              } else {
                this.showWarn('error', 'Error', this.queryDeleteErrorMessage);
                this.chatHistoryLoading = false;
              }
            })
          },
          reject: () => {
            this.chatHistoryLoading = false;
          }
        })
      } else {
        this.showWarn('error', 'Error', this.queryDeleteErrorMessage);
        this.chatHistoryLoading = false;
      }
    }
  
    showWarn(severity: string, summary: string, warningMessage: string) {
      this.messageService.clear();
      this.messageService.add({ 
        severity: severity, 
        summary: summary, 
        detail: warningMessage, 
        key: 'br',
        styleClass: `bot-history-toast-${severity}`
       });
      this.chatHistoryLoading = false;
    }
  
    showChatHistory(historydata){
      if(this.disableChatHistoryClick == false) {
        this.chatHistoryData.emit(historydata);
      } else {
        this.showWarn('warn', 'Warning', this.chatHistoryClickDisabled);
      }
    }
  
    adjustDropdownPosition(event: MouseEvent) {
      setTimeout(()=> {
        const button = event.target as HTMLElement;
        const dropdown = button.nextElementSibling as HTMLElement;
        if(dropdown) {
          this.renderer.setStyle(dropdown, 'top', `90%`);
          this.renderer.setStyle(dropdown, 'bottom', `auto`);
          const wrapperHeight = this.element.nativeElement.querySelector('.chat-history-panel');
          const dropdownRect = dropdown.getBoundingClientRect();
          const windowHeight = wrapperHeight.offsetHeight;
          if (dropdownRect.bottom > windowHeight) {
            this.renderer.setStyle(dropdown, 'bottom', `40px`);
            this.renderer.setStyle(dropdown, 'top', `auto`);
          } else {
            this.renderer.setStyle(dropdown, 'top', `90%`);
            this.renderer.setStyle(dropdown, 'bottom', `auto`);
          }
        }
      },5)
      
    }
  
    loadMoreChats() {
      this.loadMoreData.emit(this.pageNo);
      this.pageNo++;
    }
  
    onSearch(query:string) {
      const trimmedQuery = query.trim();
      if(trimmedQuery.length && trimmedQuery.length != null && trimmedQuery.length >= this.searchTriggerMinCharLimit) {
        this.searchQueries.emit(query.trim());
      } else if(query.length === 0) {
        this.searchQueries.emit('');
        this.pageNo =2;
      }
    }
  
    closeDisclaimerWindow() {
      this.showDisclaimerWindow = false;
      this.updateHeight();
    }
     
    clearSearch(){
      this.searchControl.setValue('')
    }
  }
  