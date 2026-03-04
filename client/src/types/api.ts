// Domain types (mirrored from backend src/types/domain.ts)
export type InputType = "text" | "audio" | "pdf" | "image" | "file";
export type KnowledgeBucket = "PROJECTS" | "AREAS" | "RESOURCES" | "RESEARCH" | "ARCHIVE";
export type SuggestedAction = "CREATE_PROJECT" | "CREATE_TASK" | "STORE_REFERENCE" | "FOLLOW_UP" | "NONE";
export type ActionPriority = "ALTA" | "MEDIA" | "BAIXA";
export type ActionStatus = "open" | "done" | "eliminated";
export type ProcessingStage = "capturado" | "processando" | "interpretado" | "planejado" | "concluido" | "eliminado" | "falha";

// Dashboard
export interface DashboardSummary {
  totalItems: number;
  openActions: number;
  totalProjects: number;
  statusBreakdown: { open: number; done: number; eliminated: number };
  alerts: { overdue: number; dueToday: number; missingOwner: number };
  captureBreakdown: Array<{ inputType: InputType; total: number }>;
  workflow: {
    captured: number;
    classified: number;
    actionable: number;
    resolved: number;
    eliminated: number;
  };
  latestWeeklyDebrief?: { sentAt: string; message: string };
  categories: Array<{ name: string; total: number }>;
  recentItems: DashboardItem[];
  todayFocus: FocusItem[];
  focusItems: FocusItem[];
  kanban: {
    high: KanbanItem[];
    medium: KanbanItem[];
    low: KanbanItem[];
  };
}

export interface DashboardItem {
  id: number;
  createdAt: string;
  inputType: InputType;
  categoryName: string;
  summaryPtBr: string;
  rawText?: string;
  actionDetails?: string;
  action: SuggestedAction;
  actionTitle?: string;
  priority: ActionPriority;
  status: ActionStatus;
  dueAt?: string;
  nextStep?: string;
  followUpWith?: string;
  processingStage: ProcessingStage;
  processingError?: string;
  hasFile?: boolean;
  attachmentCount?: number;
  progressive?: {
    layer2?: string[];
    layer3?: string;
    expandCount?: number;
  };
}

export interface FocusItem {
  id: number;
  categoryName: string;
  summaryPtBr: string;
  action: SuggestedAction;
  priority: ActionPriority;
  dueAt?: string;
  nextStep?: string;
  followUpWith?: string;
}

export interface KanbanItem {
  id: number;
  categoryName: string;
  summaryPtBr: string;
  action: SuggestedAction;
  priority: ActionPriority;
  dueAt?: string;
  nextStep?: string;
  followUpWith?: string;
}

// Categories
export interface Category {
  id: number;
  name: string;
  description: string;
}

// Inbox Queue
export interface InboxQueueItem {
  id: number;
  inputType: InputType;
  summaryPtBr: string;
  rawText?: string;
  actionTitle?: string;
  priority: ActionPriority;
  categoryName: string;
  createdAt: string;
  hasFile?: boolean;
}

// Attachments
export interface Attachment {
  id: number;
  itemId: number;
  fileName: string;
  inputType: InputType;
  createdAt: string;
  url: string;
}

// Search
export interface SearchResult extends DashboardItem {
  score: number | null;
}

// Jarbas (Agent Outputs)
export interface JarbasOutput {
  id: number;
  contentType: "article" | "post";
  topic?: string;
  summaryPtBr: string;
  hasFinalVersion: boolean;
  hashtags?: string[];
  hooks?: Array<{ type: string; text: string; selected?: boolean }>;
  createdAt: string;
}

// Marta (Chief of Staff)
export interface Person {
  id: number;
  name: string;
  nameVariants?: string[];
  role?: string;
  relationship?: string;
  email?: string;
  oneOnOneCadence?: string;
  notes?: string;
  active: boolean;
}

export interface PersonWithItems extends Person {
  items: {
    open: PersonItem[];
    done: PersonItem[];
    eliminated: PersonItem[];
  };
  stats: {
    totalOpen: number;
    totalDone: number;
    totalOverdue: number;
  };
  lastOneOnOne?: string;
}

export interface PersonItem {
  id: number;
  summaryPtBr: string;
  actionTitle?: string;
  priority: ActionPriority;
  status: ActionStatus;
  dueAt?: string;
  nextStep?: string;
}

export interface CosOutput {
  id: number;
  outputType: string;
  personId?: number;
  title: string;
  content: string;
  status: string;
  createdAt: string;
}

export interface Reminder {
  id: number;
  text: string;
  triggerAt: string;
  recurrence?: string;
  personName?: string;
  status: string;
}

export interface Commitment {
  id: number;
  summary: string;
  personName?: string;
  deadline?: string;
  direction: "mine" | "theirs";
  status: string;
}

export interface HealthScore {
  personName: string;
  personId: number;
  score: number;
  level: "hot" | "warm" | "cold";
  factors: {
    oneOnOneAdherence: number;
    openItemsHealth: number;
    commitmentFulfillment: number;
    contactRecency: number;
  };
  alerts: string[];
}

// API Response wrappers
export interface ApiResponse<T = void> {
  ok: boolean;
  error?: string;
}

export interface DashboardResponse extends DashboardSummary {}

export interface CategoriesResponse {
  categories: Category[];
}

export interface ActionsResponse {
  actions: DashboardItem[];
}

export interface InboxQueueResponse {
  ok: boolean;
  items: InboxQueueItem[];
  count: number;
}

export interface SearchResponse {
  ok: boolean;
  results: SearchResult[];
  mode: "semantic" | "text";
}

export interface AgentOutputsResponse {
  ok: boolean;
  outputs: JarbasOutput[];
}

export interface CosDataResponse {
  people: PersonWithItems[];
  outputs: CosOutput[];
}

export interface RemindersResponse {
  ok: boolean;
  reminders: Reminder[];
}

export interface CommitmentsResponse {
  ok: boolean;
  commitments: Commitment[];
}

export interface HealthResponse {
  ok: boolean;
  health: HealthScore[];
}

export interface PeopleResponse {
  ok: boolean;
  people: Person[];
}

// Request payloads
export interface CreateActionPayload {
  summaryPtBr: string;
  categoryName?: string;
  priority?: ActionPriority;
  actionTitle?: string;
  dueAt?: string;
  nextStep?: string;
  followUpWith?: string;
}

export interface UpdateActionPayload {
  summaryPtBr?: string;
  actionTitle?: string | null;
  priority?: ActionPriority;
  dueAt?: string | null;
  nextStep?: string | null;
  followUpWith?: string | null;
  categoryName?: string;
}

export interface ProcessInboxPayload {
  mode: "actionable" | "reference" | "trash";
  priority?: ActionPriority;
  nextStep?: string;
  followUpWith?: string;
  dueAt?: string;
}

export interface CreatePersonPayload {
  name: string;
  role?: string;
  relationship?: string;
  email?: string;
  oneOnOneCadence?: string;
  notes?: string;
}

export interface UpdatePersonPayload extends Partial<CreatePersonPayload> {}
