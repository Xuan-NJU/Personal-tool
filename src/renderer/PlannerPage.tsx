import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { AppSnapshot, DailyTodo } from '../shared/types';
import { errorMessage, personalToolApi } from './api';
import { EmptyState, Icon, Modal, Spinner } from './components';
import { addDays, dateFromKey, formatPlannerDate, toDateKey } from './format';
import type { UiSnapshot } from './model';
import type { CommitSnapshot, Notify } from './ui-types';

interface PlannerPageProps {
  snapshot: UiSnapshot;
  commitSnapshot: CommitSnapshot;
  notify: Notify;
}

type TodoPriority = DailyTodo['priority'];

interface TodoDraft {
  id?: string;
  dateKey: string;
  title: string;
  notes: string;
  priority: TodoPriority;
}

const priorityLabels: Record<TodoPriority, string> = {
  low: '低优先级',
  medium: '普通',
  high: '优先完成',
};

export function PlannerPage({ snapshot, commitSnapshot, notify }: PlannerPageProps) {
  const todayKey = toDateKey(new Date());
  const [dateKey, setDateKey] = useState(todayKey);
  const [quickTitle, setQuickTitle] = useState('');
  const [quickPriority, setQuickPriority] = useState<TodoPriority>('medium');
  const [editingTodo, setEditingTodo] = useState<DailyTodo | null>(null);
  const [deletingTodo, setDeletingTodo] = useState<DailyTodo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const dayTodos = useMemo(
    () => snapshot.todos.filter((todo) => todo.dateKey === dateKey),
    [dateKey, snapshot.todos],
  );
  const openTodos = dayTodos.filter((todo) => !todo.completed);
  const completedTodos = dayTodos.filter((todo) => todo.completed);
  const highPriorityCount = openTodos.filter((todo) => todo.priority === 'high').length;
  const completion = dayTodos.length ? Math.round((completedTodos.length / dayTodos.length) * 100) : 0;
  const selectedDate = dateFromKey(dateKey);

  const commit = async (key: string, action: () => Promise<AppSnapshot>, success: string) => {
    setBusy(key);
    try {
      commitSnapshot(await action());
      notify(success, 'success');
      return true;
    } catch (cause) {
      notify(errorMessage(cause), 'error');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const saveTodo = (draft: TodoDraft) =>
    commit(
      draft.id ? `save-${draft.id}` : 'create',
      () => personalToolApi().saveTodo({
        id: draft.id,
        dateKey: draft.dateKey,
        title: draft.title.trim(),
        notes: draft.notes.trim(),
        priority: draft.priority,
      }),
      draft.id ? '待办已更新' : '待办已加入计划',
    );

  const addQuickTodo = async (event: FormEvent) => {
    event.preventDefault();
    if (!quickTitle.trim() || busy) return;
    const saved = await saveTodo({
      dateKey,
      title: quickTitle,
      notes: '',
      priority: quickPriority,
    });
    if (saved) {
      setQuickTitle('');
      setQuickPriority('medium');
    }
  };

  const moveDate = (amount: number) => setDateKey(toDateKey(addDays(selectedDate, amount)));

  return (
    <div className="page planner-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">每日规划</p>
          <h1 className="page-title">把今天安排得刚刚好</h1>
          <p className="page-subtitle">写下真正重要的几件事，完成一项，就轻松一点。</p>
        </div>
        <div className="header-stat" aria-label={`已完成 ${completedTodos.length} 项，共 ${dayTodos.length} 项`}>
          <span>{dateKey === todayKey ? '今日进度' : '当日进度'}</span>
          <strong>{dayTodos.length ? `${completedTodos.length} / ${dayTodos.length}` : '待开始'}</strong>
        </div>
      </header>

      <div className="planner-layout">
        <section className="panel planner-board" aria-labelledby="planner-day-title">
          <div className="planner-toolbar">
            <div className="planner-date-copy">
              <p className="eyebrow">计划日期</p>
              <h2 id="planner-day-title">{formatPlannerDate(selectedDate)}</h2>
            </div>
            <div className="planner-date-controls">
              <button className="button button-icon" type="button" aria-label="前一天" onClick={() => moveDate(-1)}>
                <Icon name="chevron-left" />
              </button>
              <label className="planner-date-picker">
                <span className="sr-only">选择计划日期</span>
                <input type="date" value={dateKey} onChange={(event) => event.target.value && setDateKey(event.target.value)} />
              </label>
              <button className="button button-icon" type="button" aria-label="后一天" onClick={() => moveDate(1)}>
                <Icon name="chevron-right" />
              </button>
              {dateKey !== todayKey && (
                <button className="button button-secondary" type="button" onClick={() => setDateKey(todayKey)}>回到今天</button>
              )}
            </div>
          </div>

          <div className="planner-progress" aria-label={`完成进度 ${completion}%`}>
            <span style={{ width: `${completion}%` }} />
          </div>

          <form className="todo-composer" onSubmit={addQuickTodo}>
            <label className="todo-composer-input">
              <span className="sr-only">添加待办事项</span>
              <Icon name="plus" size={19} />
              <input
                value={quickTitle}
                onChange={(event) => setQuickTitle(event.target.value)}
                placeholder="写下一件准备完成的事…"
                maxLength={120}
              />
            </label>
            <label className="todo-priority-select">
              <span className="sr-only">优先级</span>
              <select value={quickPriority} onChange={(event) => setQuickPriority(event.target.value as TodoPriority)}>
                <option value="medium">普通</option>
                <option value="high">优先完成</option>
                <option value="low">低优先级</option>
              </select>
            </label>
            <button className="button button-primary" type="submit" disabled={!quickTitle.trim() || busy !== null}>
              {busy === 'create' ? <Spinner /> : <Icon name="plus" />}添加
            </button>
          </form>

          {!dayTodos.length ? (
            <EmptyState
              icon="list-check"
              title={dateKey === todayKey ? '今天还没有安排' : '这一天还没有安排'}
              description="从一件清晰、可以完成的小事开始。"
            />
          ) : (
            <div className="todo-sections">
              <TodoSection
                title="准备完成"
                count={openTodos.length}
                emptyText="这一天的待办已经全部完成。"
                todos={openTodos}
                busy={busy}
                onToggle={(todo) => void commit(`toggle-${todo.id}`, () => personalToolApi().toggleTodo(todo.id), todo.completed ? '已重新加入计划' : '完成一项，做得好')}
                onEdit={setEditingTodo}
                onDelete={setDeletingTodo}
              />
              {completedTodos.length > 0 && (
                <TodoSection
                  title="已经完成"
                  count={completedTodos.length}
                  todos={completedTodos}
                  completed
                  busy={busy}
                  onToggle={(todo) => void commit(`toggle-${todo.id}`, () => personalToolApi().toggleTodo(todo.id), '已重新加入计划')}
                  onEdit={setEditingTodo}
                  onDelete={setDeletingTodo}
                />
              )}
            </div>
          )}
        </section>

        <aside className="planner-side" aria-label="计划概览">
          <section className="panel planner-overview-card">
            <div className="planner-overview-icon"><Icon name="list-check" size={23} /></div>
            <div>
              <p className="eyebrow">这一天</p>
              <h2>{completion}% 完成</h2>
              <p>{dayTodos.length ? '保持节奏，不必一次把所有事情都做完。' : '留一点空间，再决定今天最值得做什么。'}</p>
            </div>
            <dl className="planner-metrics">
              <div><dt>待完成</dt><dd>{openTodos.length}</dd></div>
              <div><dt>优先事项</dt><dd>{highPriorityCount}</dd></div>
              <div><dt>已完成</dt><dd>{completedTodos.length}</dd></div>
            </dl>
          </section>

          <section className="panel local-storage-card">
            <span><Icon name="device" size={20} /></span>
            <div><strong>安全保存在本机</strong><p>每日规划目前不会上传到 Notion，离线也能继续使用。</p></div>
          </section>
        </aside>
      </div>

      <TodoEditor
        todo={editingTodo}
        busy={Boolean(editingTodo && busy === `save-${editingTodo.id}`)}
        onClose={() => !busy && setEditingTodo(null)}
        onSave={async (draft) => {
          const saved = await saveTodo(draft);
          if (saved) setEditingTodo(null);
        }}
      />

      <Modal
        open={Boolean(deletingTodo)}
        title="删除这项待办？"
        description="删除后无法恢复，但不会影响日历或专注记录。"
        onClose={() => !busy && setDeletingTodo(null)}
        width="440px"
        footer={<>
          <button className="button button-secondary" type="button" disabled={Boolean(busy)} onClick={() => setDeletingTodo(null)}>取消</button>
          <button
            className="button button-danger"
            type="button"
            disabled={!deletingTodo || Boolean(busy)}
            onClick={async () => {
              if (!deletingTodo) return;
              const deleted = await commit(`delete-${deletingTodo.id}`, () => personalToolApi().deleteTodo(deletingTodo.id), '待办已删除');
              if (deleted) setDeletingTodo(null);
            }}
          >
            {deletingTodo && busy === `delete-${deletingTodo.id}` ? <Spinner /> : <Icon name="trash" />}确认删除
          </button>
        </>}
      >
        <p className="confirm-copy">{deletingTodo?.title}</p>
      </Modal>
    </div>
  );
}

function TodoSection({
  title,
  count,
  todos,
  emptyText,
  completed = false,
  busy,
  onToggle,
  onEdit,
  onDelete,
}: {
  title: string;
  count: number;
  todos: DailyTodo[];
  emptyText?: string;
  completed?: boolean;
  busy: string | null;
  onToggle: (todo: DailyTodo) => void;
  onEdit: (todo: DailyTodo) => void;
  onDelete: (todo: DailyTodo) => void;
}) {
  return (
    <section className={`todo-section ${completed ? 'is-completed' : ''}`}>
      <header className="todo-section-heading">
        <h3>{title}</h3>
        <span>{count}</span>
      </header>
      {todos.length ? (
        <div className="todo-list">
          {todos.map((todo) => {
            const toggling = busy === `toggle-${todo.id}`;
            return (
              <article className={`todo-item ${todo.completed ? 'is-completed' : ''}`} key={todo.id}>
                <button
                  className="todo-toggle"
                  type="button"
                  aria-pressed={todo.completed}
                  aria-label={todo.completed ? `将“${todo.title}”标记为未完成` : `完成“${todo.title}”`}
                  disabled={Boolean(busy)}
                  onClick={() => onToggle(todo)}
                >
                  {toggling ? <Spinner /> : todo.completed ? <Icon name="check" size={17} /> : null}
                </button>
                <button className="todo-copy" type="button" disabled={Boolean(busy)} onClick={() => onEdit(todo)}>
                  <strong>{todo.title}</strong>
                  {todo.notes && <small>{todo.notes}</small>}
                </button>
                <span className={`priority-badge priority-${todo.priority}`}>{priorityLabels[todo.priority]}</span>
                <div className="todo-actions">
                  <button className="button button-icon" type="button" aria-label={`编辑 ${todo.title}`} disabled={Boolean(busy)} onClick={() => onEdit(todo)}><Icon name="edit" size={16} /></button>
                  <button className="button button-icon danger-icon" type="button" aria-label={`删除 ${todo.title}`} disabled={Boolean(busy)} onClick={() => onDelete(todo)}><Icon name="trash" size={16} /></button>
                </div>
              </article>
            );
          })}
        </div>
      ) : emptyText ? <p className="todo-section-empty">{emptyText}</p> : null}
    </section>
  );
}

function TodoEditor({
  todo,
  busy,
  onClose,
  onSave,
}: {
  todo: DailyTodo | null;
  busy: boolean;
  onClose: () => void;
  onSave: (draft: TodoDraft) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState<TodoPriority>('medium');
  const [dateKey, setDateKey] = useState('');

  useEffect(() => {
    if (!todo) return;
    setTitle(todo.title);
    setNotes(todo.notes);
    setPriority(todo.priority);
    setDateKey(todo.dateKey);
  }, [todo]);

  return (
    <Modal
      open={Boolean(todo)}
      title="编辑待办"
      description="补充细节、调整优先级，或者把它移到另一天。"
      onClose={onClose}
      width="520px"
      footer={<>
        <button className="button button-secondary" type="button" disabled={busy} onClick={onClose}>取消</button>
        <button className="button button-primary" type="button" disabled={busy || !title.trim() || !dateKey} onClick={() => todo && void onSave({ id: todo.id, dateKey, title, notes, priority })}>
          {busy ? <Spinner /> : <Icon name="check" />}保存修改
        </button>
      </>}
    >
      <div className="todo-editor-form">
        <label className="form-field form-field-full"><span>待办事项</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} /></label>
        <div className="inline-fields">
          <label className="form-field"><span>计划日期</span><input type="date" value={dateKey} onChange={(event) => setDateKey(event.target.value)} /></label>
          <label className="form-field"><span>优先级</span><select value={priority} onChange={(event) => setPriority(event.target.value as TodoPriority)}><option value="high">优先完成</option><option value="medium">普通</option><option value="low">低优先级</option></select></label>
        </div>
        <label className="form-field form-field-full"><span>备注 <small>选填</small></span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} maxLength={600} placeholder="补充上下文、完成标准或相关链接…" /></label>
      </div>
    </Modal>
  );
}
