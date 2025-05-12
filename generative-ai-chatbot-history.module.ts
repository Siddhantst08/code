import { CUSTOM_ELEMENTS_SCHEMA, NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GenerativeAiChatbotHistoryComponent } from './generative-ai-chatbot-history.component';
import { FormsModule,ReactiveFormsModule } from '@angular/forms';
import { ToastModule } from 'primeng/toast';
import {ConfirmDialogModule} from 'primeng/confirmdialog';
import { TooltipModule } from 'primeng/tooltip';


@NgModule({
  declarations: [
    GenerativeAiChatbotHistoryComponent
  ],
  imports: [
    CommonModule,
    TooltipModule,
    FormsModule,
    ToastModule,
    ConfirmDialogModule,
    ReactiveFormsModule
  ],
   exports: [
    GenerativeAiChatbotHistoryComponent
],
schemas: [ CUSTOM_ELEMENTS_SCHEMA ] //Most Imp
})
export class GenerativeAiChatbotHistoryModule { }
