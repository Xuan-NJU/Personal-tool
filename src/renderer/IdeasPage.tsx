import { useEffect, useMemo, useState } from 'react';
import type { AppSnapshot, ResearchIdea } from '../shared/types';
import { errorMessage, personalToolApi } from './api';
import { EmptyState, Icon, Modal, Spinner } from './components';
import { formatUpdatedTime } from './format';
import type { UiSnapshot } from './model';
import type { CommitSnapshot, Notify } from './ui-types';

interface IdeasPageProps {
  snapshot: UiSnapshot;
  commitSnapshot: CommitSnapshot;
  notify: Notify;
}

type IdeaStatus = ResearchIdea['status'];
type IdeaFilter = 'all' | IdeaStatus;

interface IdeaDraft {
  id?: string;
  title: string;
  summary: string;
  tags: string[];
  status: IdeaStatus;
}

const statusLabels: Record<IdeaStatus, string> = {
  seed: '灵感种子',
  exploring: '探索中',
  validated: '已验证',
  archived: '已归档',
};

export function IdeasPage({ snapshot, commitSnapshot, notify }: IdeasPageProps) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<IdeaFilter>('all');
  const [editorIdea, setEditorIdea] = useState<ResearchIdea | null | undefined>(undefined);
  const [deletingIdea, setDeletingIdea] = useState<ResearchIdea | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const visibleIdeas = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('zh-CN');
    return snapshot.ideas.filter((idea) => {
      if (statusFilter !== 'all' && idea.status !== statusFilter) return false;
      if (!needle) return true;
      return [idea.title, idea.summary, ...idea.tags].some((value) => value.toLocaleLowerCase('zh-CN').includes(needle));
    });
  }, [query, snapshot.ideas, statusFilter]);

  const activeIdeas = snapshot.ideas.filter((idea) => idea.status !== 'archived');
  const exploringCount = snapshot.ideas.filter((idea) => idea.status === 'exploring').length;
  const validatedCount = snapshot.ideas.filter((idea) => idea.status === 'validated').length;

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

  const saveIdea = (draft: IdeaDraft) =>
    commit(
      draft.id ? `save-${draft.id}` : 'save-new',
      () => personalToolApi().saveIdea({
        id: draft.id,
        title: draft.title.trim(),
        summary: draft.summary.trim(),
        tags: draft.tags,
        status: draft.status,
      }),
      draft.id ? '科研灵感已更新' : '新的科研灵感已收好',
    );

  const hasFilters = Boolean(query.trim()) || statusFilter !== 'all';

  return (
    <div className="page ideas-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">科研灵感库</p>
          <h1 className="page-title">让每一个想法都有落脚处</h1>
          <p className="page-subtitle">随手记下问题、方法与猜想，再慢慢把它们长成可以验证的研究。</p>
        </div>
        <div className="header-stat" aria-label={`未归档灵感 ${activeIdeas.length} 条`}>
          <span>活跃灵感</span>
          <strong>{activeIdeas.length} 条</strong>
        </div>
      </header>

      <section className="panel ideas-workspace">
        <div className="ideas-toolbar">
          <label className="idea-search-field">
            <span className="sr-only">搜索科研灵感</span>
            <Icon name="search" size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、内容或标签…" />
            {query && <button type="button" aria-label="清除搜索" onClick={() => setQuery('')}><Icon name="close" size={15} /></button>}
          </label>
          <label className="idea-filter-field">
            <span className="sr-only">按状态筛选</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as IdeaFilter)}>
              <option value="all">全部状态</option>
              <option value="seed">灵感种子</option>
              <option value="exploring">探索中</option>
              <option value="validated">已验证</option>
              <option value="archived">已归档</option>
            </select>
          </label>
          <button className="button button-primary" type="button" onClick={() => setEditorIdea(null)}><Icon name="plus" />记录灵感</button>
        </div>

        <div className="ideas-summary-strip" aria-label="灵感状态概览">
          <span><i className="summary-dot is-seed" />共 {snapshot.ideas.length} 条</span>
          <span><i className="summary-dot is-exploring" />探索中 {exploringCount}</span>
          <span><i className="summary-dot is-validated" />已验证 {validatedCount}</span>
          <span className="ideas-local-note"><Icon name="device" size={16} />仅保存在本机</span>
        </div>

        {!visibleIdeas.length ? (
          <EmptyState
            icon={hasFilters ? 'search' : 'lightbulb'}
            title={hasFilters ? '没有找到相符的灵感' : '灵感库还是一张白纸'}
            description={hasFilters ? '试试更短的关键词，或切换到其他状态。' : '不用等想法成熟，先把最初的火花记下来。'}
            action={hasFilters
              ? <button className="button button-secondary" type="button" onClick={() => { setQuery(''); setStatusFilter('all'); }}>清除筛选</button>
              : <button className="button button-secondary" type="button" onClick={() => setEditorIdea(null)}><Icon name="plus" />写下第一条灵感</button>}
          />
        ) : (
          <div className="idea-grid">
            {visibleIdeas.map((idea) => (
              <article className={`idea-card idea-card-${idea.status}`} key={idea.id}>
                <header className="idea-card-header">
                  <span className={`idea-status idea-status-${idea.status}`}>{statusLabels[idea.status]}</span>
                  <div className="idea-card-actions">
                    <button className="button button-icon" type="button" aria-label={`编辑 ${idea.title}`} disabled={Boolean(busy)} onClick={() => setEditorIdea(idea)}><Icon name="edit" size={16} /></button>
                    <button className="button button-icon danger-icon" type="button" aria-label={`删除 ${idea.title}`} disabled={Boolean(busy)} onClick={() => setDeletingIdea(idea)}><Icon name="trash" size={16} /></button>
                  </div>
                </header>
                <button className="idea-card-main" type="button" onClick={() => setEditorIdea(idea)}>
                  <h2>{idea.title}</h2>
                  <p>{idea.summary || '还没有补充说明，点击继续展开这个想法。'}</p>
                </button>
                <div className="idea-tags" aria-label={idea.tags.length ? `标签：${idea.tags.join('、')}` : '暂无标签'}>
                  {idea.tags.length ? idea.tags.slice(0, 5).map((tag) => <span key={tag}>#{tag}</span>) : <span className="is-placeholder">等待添加标签</span>}
                  {idea.tags.length > 5 && <span>+{idea.tags.length - 5}</span>}
                </div>
                <footer className="idea-card-footer"><Icon name="clock" size={15} /><span>{formatUpdatedTime(idea.updatedAt)}</span></footer>
              </article>
            ))}
          </div>
        )}
      </section>

      <IdeaEditor
        open={editorIdea !== undefined}
        idea={editorIdea ?? null}
        busy={busy === (editorIdea ? `save-${editorIdea.id}` : 'save-new')}
        onClose={() => !busy && setEditorIdea(undefined)}
        onSave={async (draft) => {
          const saved = await saveIdea(draft);
          if (saved) setEditorIdea(undefined);
        }}
      />

      <Modal
        open={Boolean(deletingIdea)}
        title="删除这条科研灵感？"
        description="删除后无法恢复。它只会从本机灵感库移除。"
        onClose={() => !busy && setDeletingIdea(null)}
        width="440px"
        footer={<>
          <button className="button button-secondary" type="button" disabled={Boolean(busy)} onClick={() => setDeletingIdea(null)}>取消</button>
          <button
            className="button button-danger"
            type="button"
            disabled={!deletingIdea || Boolean(busy)}
            onClick={async () => {
              if (!deletingIdea) return;
              const deleted = await commit(`delete-${deletingIdea.id}`, () => personalToolApi().deleteIdea(deletingIdea.id), '科研灵感已删除');
              if (deleted) setDeletingIdea(null);
            }}
          >
            {deletingIdea && busy === `delete-${deletingIdea.id}` ? <Spinner /> : <Icon name="trash" />}确认删除
          </button>
        </>}
      >
        <p className="confirm-copy">{deletingIdea?.title}</p>
      </Modal>
    </div>
  );
}

function IdeaEditor({
  open,
  idea,
  busy,
  onClose,
  onSave,
}: {
  open: boolean;
  idea: ResearchIdea | null;
  busy: boolean;
  onClose: () => void;
  onSave: (draft: IdeaDraft) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [tags, setTags] = useState('');
  const [status, setStatus] = useState<IdeaStatus>('seed');

  useEffect(() => {
    if (!open) return;
    setTitle(idea?.title ?? '');
    setSummary(idea?.summary ?? '');
    setTags(idea?.tags.join('，') ?? '');
    setStatus(idea?.status ?? 'seed');
  }, [idea, open]);

  const parsedTags = Array.from(new Set(tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean))).slice(0, 12);

  return (
    <Modal
      open={open}
      title={idea ? '编辑科研灵感' : '记录科研灵感'}
      description="先忠实保存想法，再决定它是否值得继续验证。"
      onClose={onClose}
      width="620px"
      footer={<>
        <button className="button button-secondary" type="button" disabled={busy} onClick={onClose}>取消</button>
        <button className="button button-primary" type="button" disabled={busy || !title.trim()} onClick={() => void onSave({ id: idea?.id, title, summary, tags: parsedTags, status })}>
          {busy ? <Spinner /> : <Icon name="check" />}{idea ? '保存修改' : '保存灵感'}
        </button>
      </>}
    >
      <div className="idea-editor-form">
        <label className="form-field form-field-full"><span>一句话标题</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={140} placeholder="例如：利用无源标签反射模式估计遮挡区域" /></label>
        <label className="form-field form-field-full"><span>想法说明</span><textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={7} maxLength={4000} placeholder="问题是什么？为什么值得研究？可能的方法和验证路径是什么？" /></label>
        <div className="inline-fields idea-meta-fields">
          <label className="form-field"><span>标签 <small>用逗号分隔</small></span><input value={tags} onChange={(event) => setTags(event.target.value)} maxLength={300} placeholder="RFID，感知，仓储" /></label>
          <label className="form-field"><span>研究状态</span><select value={status} onChange={(event) => setStatus(event.target.value as IdeaStatus)}><option value="seed">灵感种子</option><option value="exploring">探索中</option><option value="validated">已验证</option><option value="archived">已归档</option></select></label>
        </div>
        {parsedTags.length > 0 && <div className="idea-tag-preview">{parsedTags.map((tag) => <span key={tag}>#{tag}</span>)}</div>}
        <div className="modal-sync-note local-only-note"><Icon name="device" /><span>科研灵感仅保存在这台电脑上，不会同步到 Notion。</span></div>
      </div>
    </Modal>
  );
}
