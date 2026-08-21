import React, { ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw, FolderOpen, X, Copy, Check, FileCode2 } from "lucide-react";

interface Props {
  children: ReactNode;
  projectPath?: string;
  onClose?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

export class BackstageErrorBoundary extends React.Component<Props, State> {
  state: State;
  props: Props;
  setState!: (state: Partial<State> | ((prevState: State) => Partial<State>), callback?: () => void) => void;

  constructor(props: Props) {
    super(props);
    this.props = props;
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
    };
    this.handleReset = this.handleReset.bind(this);
    this.handleCopyError = this.handleCopyError.bind(this);
    this.handleOpenFolder = this.handleOpenFolder.bind(this);
  }

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
      copied: false,
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[BackstageErrorBoundary] Caught error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReset() {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
    });
  }

  private handleCopyError() {
    const text = `Backstage Editor Error:\n${this.state.error?.toString()}\n\nStack:\n${this.state.errorInfo?.componentStack || this.state.error?.stack || 'No stack'}`;
    navigator.clipboard.writeText(text);
    this.setState({ copied: true });
    setTimeout(() => this.setState({ copied: false }), 2000);
  }

  private handleOpenFolder() {
    if (this.props.projectPath && window.electronAPI) {
      const path = `${this.props.projectPath}/takes`;
      window.electronAPI.openPath?.(path).catch((err: any) => {
        console.error("Failed to open takes folder:", err);
      });
    }
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-[100] bg-zinc-950/90 backdrop-blur-md flex items-center justify-center p-8 font-sans">
          <div className="w-full max-w-3xl bg-zinc-900 border border-rose-500/30 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-white">
            {/* Top Bar */}
            <div className="h-14 border-b border-rose-500/20 bg-rose-950/30 px-6 flex items-center justify-between">
              <div className="flex items-center gap-3 text-rose-400 font-bold text-sm">
                <AlertTriangle className="w-5 h-5 text-rose-500 animate-pulse" />
                Редактор бэкстейджа (Защищенный режим)
              </div>
              {this.props.onClose && (
                <button
                  onClick={this.props.onClose}
                  className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
                  title="Закрыть"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>

            {/* Error Content */}
            <div className="p-6 space-y-6 overflow-y-auto max-h-[80vh]">
              <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4 flex items-start gap-4">
                <FileCode2 className="w-8 h-8 text-rose-400 shrink-0 mt-0.5" />
                <div className="space-y-1 min-w-0">
                  <h3 className="font-bold text-base text-rose-200">
                    Обнаружена ошибка при работе редактора бэкстейджа
                  </h3>
                  <p className="text-xs text-rose-300/80 leading-relaxed">
                    Редактор остался открыт и перехвачен системой защиты. Ниже приведены детали сбоя и возможная причина недоступности данных.
                  </p>
                </div>
              </div>

              {/* Error Message Box */}
              <div className="space-y-2">
                <div className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center justify-between">
                  <span>Текст ошибки</span>
                  <button
                    onClick={this.handleCopyError}
                    className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-white transition-colors bg-zinc-800 px-2 py-0.5 rounded border border-white/5"
                  >
                    {this.state.copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    {this.state.copied ? "Скопировано" : "Скопировать отчет"}
                  </button>
                </div>
                <div className="bg-zinc-950 p-4 rounded-xl border border-white/10 font-mono text-xs text-rose-300 break-words select-text">
                  {this.state.error?.toString() || "Неизвестная ошибка рендеринга"}
                </div>
              </div>

              {/* Stack Trace */}
              {this.state.errorInfo?.componentStack && (
                <div className="space-y-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                    Стек компонентов
                  </span>
                  <div className="bg-zinc-950/70 p-3 rounded-xl border border-white/5 font-mono text-[11px] text-zinc-400 max-h-36 overflow-y-auto whitespace-pre-wrap select-text">
                    {this.state.errorInfo.componentStack}
                  </div>
                </div>
              )}

              {/* Project Info */}
              {this.props.projectPath && (
                <div className="text-xs text-zinc-400 bg-zinc-800/40 p-3 rounded-xl border border-white/5 flex items-center justify-between">
                  <span className="truncate">Папка проекта: <code className="text-zinc-200 font-mono">{this.props.projectPath}</code></span>
                  {window.electronAPI?.openPath && (
                    <button
                      onClick={this.handleOpenFolder}
                      className="flex items-center gap-1.5 text-xs text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 px-3 py-1.5 rounded-lg border border-rose-500/20 transition-all shrink-0 ml-3 font-medium"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      Папка записей (/takes)
                    </button>
                  )}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-2 border-t border-white/10">
                <button
                  onClick={this.handleReset}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl font-medium text-xs flex items-center gap-2 transition-all shadow-lg active:scale-95"
                >
                  <RefreshCw className="w-4 h-4" />
                  Перезапустить редактор
                </button>
                {this.props.onClose && (
                  <button
                    onClick={this.props.onClose}
                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl font-medium text-xs transition-colors"
                  >
                    Закрыть
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
