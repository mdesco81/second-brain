export type InputType = "text" | "audio" | "pdf" | "image" | "file";

export type KnowledgeBucket =
  | "PROJECTS"
  | "AREAS"
  | "RESOURCES"
  | "RESEARCH"
  | "ARCHIVE";

export type SuggestedAction =
  | "CREATE_PROJECT"
  | "CREATE_TASK"
  | "STORE_REFERENCE"
  | "FOLLOW_UP"
  | "NONE";

export type ActionPriority = "ALTA" | "MEDIA" | "BAIXA";
export type ActionStatus = "open" | "done" | "eliminated";
export type ProcessingStage = "capturado" | "processando" | "interpretado" | "planejado" | "concluido" | "eliminado" | "falha";

export interface IntakePayload {
  chatId: number;
  messageId: number;
  inputType: InputType;
  text: string;
  mediaPath?: string;
  metadata?: Record<string, unknown>;
}

export interface ClassificationResult {
  summaryPtBr: string;
  categoryName: string;
  categoryDescription: string;
  bucket: KnowledgeBucket;
  action: SuggestedAction;
  actionTitle?: string;
  actionDetails?: string;
  nextStepPtBr?: string;
  followUpWithPtBr?: string;
  dueDateISO?: string;
  priority: ActionPriority;
  confidence: number;
  shouldCreateCategory: boolean;
  followUpQuestionPtBr?: string;
}

export interface DashboardSummary {
  totalItems: number;
  openActions: number;
  totalProjects: number;
  statusBreakdown: {
    open: number;
    done: number;
    eliminated: number;
  };
  alerts: {
    overdue: number;
    dueToday: number;
    missingOwner: number;
  };
  captureBreakdown: Array<{
    inputType: InputType;
    total: number;
  }>;
  workflow: {
    captured: number;
    classified: number;
    actionable: number;
    resolved: number;
    eliminated: number;
  };
  latestWeeklyDebrief?: {
    sentAt: string;
    message: string;
  };
  categories: Array<{ name: string; total: number }>;
  recentItems: Array<{
    id: number;
    createdAt: string;
    inputType: InputType;
    categoryName: string;
    summaryPtBr: string;
    action: SuggestedAction;
    actionTitle?: string;
    priority: ActionPriority;
    status: ActionStatus;
    dueAt?: string;
    nextStep?: string;
    followUpWith?: string;
    processingStage: ProcessingStage;
    processingError?: string;
  }>;
  todayFocus: Array<{
    id: number;
    categoryName: string;
    summaryPtBr: string;
    action: SuggestedAction;
    priority: ActionPriority;
    dueAt?: string;
    nextStep?: string;
    followUpWith?: string;
  }>;
  focusItems: Array<{
    id: number;
    categoryName: string;
    summaryPtBr: string;
    action: SuggestedAction;
    priority: ActionPriority;
    dueAt?: string;
    followUpWith?: string;
  }>;
  kanban: {
    high: Array<{
      id: number;
      categoryName: string;
      summaryPtBr: string;
      action: SuggestedAction;
      priority: ActionPriority;
      dueAt?: string;
      nextStep?: string;
      followUpWith?: string;
    }>;
    medium: Array<{
      id: number;
      categoryName: string;
      summaryPtBr: string;
      action: SuggestedAction;
      priority: ActionPriority;
      dueAt?: string;
      nextStep?: string;
      followUpWith?: string;
    }>;
    low: Array<{
      id: number;
      categoryName: string;
      summaryPtBr: string;
      action: SuggestedAction;
      priority: ActionPriority;
      dueAt?: string;
      nextStep?: string;
      followUpWith?: string;
    }>;
  };
}
