export type InteractiveFormViewModel = {
  title: string;
  content: string;
  footer: string;
};

export type InteractiveSessionViewModel = {
  title: string;
  header: string;
  footer: string;
  helpVisible: boolean;
  helpText: string;
  helpScrollOffset: number;
  flowListTitle: string;
  flowItems: Array<{
    key: string;
    label: string;
  }>;
  selectedFlowIndex: number;
  progressTitle: string;
  progressText: string;
  progressScrollOffset: number;
  descriptionText: string;
  statusText: string;
  summaryVisible: boolean;
  summaryTitle: string;
  summaryText: string;
  summaryScrollOffset: number;
  logTitle: string;
  logText: string;
  logScrollOffset: number;
  confirmText: string | null;
  form: InteractiveFormViewModel | null;
};
