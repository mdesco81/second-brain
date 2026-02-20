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
  categories: Array<{ name: string; total: number }>;
  recentItems: Array<{
    id: number;
    createdAt: string;
    inputType: InputType;
    categoryName: string;
    summaryPtBr: string;
    action: SuggestedAction;
    priority: ActionPriority;
    status: string;
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
