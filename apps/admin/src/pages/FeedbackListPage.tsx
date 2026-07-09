import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useApiQuery } from '../lib/useApiQuery';
import { usePlatformAuth } from '../providers/PlatformAuthProvider';
import { useT } from '../i18n';
import { canMutate } from '../lib/platform-roles';
import {
  Alert,
  Badge,
  Button,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Table,
  type Column,
} from '../components/ui';
import type { Tone } from '../components/ui';
import type { FeedbackKind, FeedbackStatus, PlatformFeedbackRow } from '../lib/feedback-types';

const STATUS_KEY: Record<FeedbackStatus, string> = {
  submitted: 'feedback.statusSubmitted',
  in_progress: 'feedback.statusInProgress',
  shipped: 'feedback.statusShipped',
  rejected: 'feedback.statusRejected',
};
const STATUS_TONE: Record<FeedbackStatus, Tone> = {
  submitted: 'info',
  in_progress: 'warning',
  shipped: 'success',
  rejected: 'neutral',
};
const KIND_KEY: Record<FeedbackKind, string> = {
  bug: 'feedback.kindBug',
  improvement: 'feedback.kindImprovement',
  question: 'feedback.kindQuestion',
};
const KIND_TONE: Record<FeedbackKind, Tone> = {
  bug: 'critical',
  improvement: 'primary',
  question: 'neutral',
};

const STATUS_ORDER: FeedbackStatus[] = ['submitted', 'in_progress', 'shipped', 'rejected'];

export function FeedbackListPage() {
  const { state } = usePlatformAuth();
  const t = useT();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | ''>('');
  const [kindFilter, setKindFilter] = useState<FeedbackKind | ''>('');
  const [search, setSearch] = useState('');

  const accessToken = state.status === 'authenticated' ? state.accessToken : null;
  const mayMutate = state.status === 'authenticated' && canMutate(state.admin.role);

  const [triageTarget, setTriageTarget] = useState<PlatformFeedbackRow | null>(null);
  const [triageForm, setTriageForm] = useState<{
    status: FeedbackStatus;
    githubIssueNo: string;
    shippedVersion: string;
  }>({ status: 'submitted', githubIssueNo: '', shippedVersion: '' });
  const [triageSaving, setTriageSaving] = useState(false);
  const [triageError, setTriageError] = useState<string | null>(null);

  const openTriage = (r: PlatformFeedbackRow) => {
    setTriageTarget(r);
    setTriageForm({
      status: r.status,
      githubIssueNo: r.githubIssueNo != null ? String(r.githubIssueNo) : '',
      shippedVersion: r.shippedVersion ?? '',
    });
    setTriageError(null);
  };

  const submitTriage = async () => {
    if (!accessToken || !triageTarget) return;
    const trimmedIssue = triageForm.githubIssueNo.trim();
    setTriageSaving(true);
    setTriageError(null);
    try {
      await api(`/platform/feedback/${triageTarget.id}`, {
        method: 'PATCH',
        bearer: accessToken,
        body: {
          status: triageForm.status,
          githubIssueNo: trimmedIssue ? Number(trimmedIssue) : null,
          shippedVersion: triageForm.shippedVersion.trim() || null,
        },
      });
      setTriageTarget(null);
      await qc.invalidateQueries({ queryKey: ['feedback'] });
    } catch (err) {
      setTriageError(err instanceof ApiError ? err.message : t('feedback.triageError'));
    } finally {
      setTriageSaving(false);
    }
  };

  const issueNoValid = (() => {
    const v = triageForm.githubIssueNo.trim();
    if (!v) return true;
    return /^[0-9]+$/.test(v) && Number(v) >= 1;
  })();

  // #944 (F2) — elle useEffect+AbortController+useState yerine useApiQuery.
  // #882 60sn sessiz tazeleme refetchInterval ile (data korunur → spinner flash
  // yok). Filtreler queryKey'de → değişince otomatik yeniden çekilir.
  const feedbackQuery = useApiQuery(
    ['feedback', statusFilter, kindFilter],
    () =>
      api<PlatformFeedbackRow[]>('/platform/feedback', {
        bearer: accessToken ?? undefined,
        query: { status: statusFilter || undefined, kind: kindFilter || undefined },
      }),
    { enabled: !!accessToken, refetchInterval: 60_000 },
  );

  const rows = feedbackQuery.data ?? null;
  // Hata yalnız ilk yüklemede (veri yokken) gösterilir; arka-plan tazeleme
  // hataları sessiz (eski davranış).
  const loadError =
    feedbackQuery.isError && feedbackQuery.data === undefined
      ? feedbackQuery.error instanceof ApiError
        ? feedbackQuery.error.message
        : t('feedback.loadError')
      : null;

  const q = search.trim().toLocaleLowerCase('tr');
  const visible = rows
    ? rows.filter(
        (r) =>
          !q ||
          r.title.toLocaleLowerCase('tr').includes(q) ||
          r.tenant.name.toLocaleLowerCase('tr').includes(q),
      )
    : null;

  const columns: Column<PlatformFeedbackRow>[] = [
    {
      key: 'date',
      header: t('feedback.colDate'),
      cellClassName: 'whitespace-nowrap text-muted-foreground',
      render: (r) => new Date(r.createdAt).toLocaleDateString('tr-TR'),
    },
    {
      key: 'clinic',
      header: t('feedback.colClinic'),
      render: (r) => (
        <>
          <div className="font-medium">{r.tenant.name}</div>
          <div className="font-mono text-xs text-muted-foreground">{r.tenant.slug}</div>
        </>
      ),
    },
    {
      key: 'kind',
      header: t('feedback.colKind'),
      render: (r) => <Badge tone={KIND_TONE[r.kind]}>{t(KIND_KEY[r.kind])}</Badge>,
    },
    {
      key: 'status',
      header: t('feedback.colStatus'),
      render: (r) => <Badge tone={STATUS_TONE[r.status]}>{t(STATUS_KEY[r.status])}</Badge>,
    },
    {
      key: 'request',
      header: t('feedback.colRequest'),
      cellClassName: 'max-w-md',
      render: (r) => (
        <>
          <div className="font-medium">{r.title}</div>
          <div className="line-clamp-2 text-xs text-muted-foreground">{r.description}</div>
          <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
            {r.routePath} · v{r.appVersion} · {r.submittedBy.email}
          </div>
        </>
      ),
    },
    {
      key: 'github',
      header: t('feedback.colGithub'),
      cellClassName: 'whitespace-nowrap tabular-nums text-muted-foreground',
      render: (r) =>
        `${r.githubIssueNo ? `#${r.githubIssueNo}` : '—'}${
          r.shippedVersion ? ` · v${r.shippedVersion}` : ''
        }`,
    },
    ...(mayMutate
      ? [
          {
            key: 'actions',
            header: '',
            cellClassName: 'whitespace-nowrap',
            render: (r: PlatformFeedbackRow) => (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => openTriage(r)}
                data-testid={`feedback-triage-${r.id}`}
              >
                {t('feedback.triage')}
              </Button>
            ),
          } satisfies Column<PlatformFeedbackRow>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4" data-testid="feedback-list-page">
      <PageHeader title={t('feedback.title')} />

      <p className="text-sm text-muted-foreground">{t('feedback.subtitle')}</p>

      <div className="flex flex-wrap gap-2">
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as FeedbackStatus | '')}
          data-testid="filter-status"
          className="h-9 w-auto"
        >
          <option value="">{t('feedback.filterStatusAll')}</option>
          {(['submitted', 'in_progress', 'shipped', 'rejected'] as FeedbackStatus[]).map((s) => (
            <option key={s} value={s}>
              {t(STATUS_KEY[s])}
            </option>
          ))}
        </Select>
        <Select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as FeedbackKind | '')}
          data-testid="filter-kind"
          className="h-9 w-auto"
        >
          <option value="">{t('feedback.filterKindAll')}</option>
          {(['bug', 'improvement', 'question'] as FeedbackKind[]).map((k) => (
            <option key={k} value={k}>
              {t(KIND_KEY[k])}
            </option>
          ))}
        </Select>
        <Input
          type="text"
          placeholder={t('feedback.filterSearch')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="filter-search"
          className="h-9 w-60"
        />
      </div>

      {loadError && <Alert tone="error">{loadError}</Alert>}

      {feedbackQuery.isLoading ? (
        <Spinner label={t('common.loading')} />
      ) : !loadError ? (
        <Table
          columns={columns}
          rows={visible ?? []}
          rowKey={(r) => r.id}
          rowTestId={(r) => `feedback-row-${r.id}`}
          empty={t('feedback.empty')}
          data-testid="feedback-table"
        />
      ) : null}

      <Modal
        open={!!triageTarget}
        onClose={() => !triageSaving && setTriageTarget(null)}
        testId="feedback-triage-modal"
      >
        <h2 className="text-[15px] font-semibold text-foreground">{t('feedback.triageTitle')}</h2>
        {triageTarget && (
          <p className="mt-1 line-clamp-2 text-[13px] text-muted-foreground">
            {triageTarget.tenant.name} — {triageTarget.title}
          </p>
        )}
        {triageError && (
          <Alert tone="error" className="mt-3">
            {triageError}
          </Alert>
        )}
        <div className="mt-4 space-y-3">
          <Field label={t('feedback.colStatus')}>
            <Select
              value={triageForm.status}
              onChange={(e) =>
                setTriageForm({ ...triageForm, status: e.target.value as FeedbackStatus })
              }
              data-testid="triage-status"
            >
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {t(STATUS_KEY[s])}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t('feedback.fieldGithubIssue')}
            hint={t('feedback.fieldGithubIssueHint')}
            error={!issueNoValid ? t('feedback.issueInvalid') : undefined}
          >
            <Input
              inputMode="numeric"
              value={triageForm.githubIssueNo}
              onChange={(e) => setTriageForm({ ...triageForm, githubIssueNo: e.target.value })}
              placeholder="951"
              data-testid="triage-issue"
            />
          </Field>
          <Field label={t('feedback.fieldShippedVersion')} hint={t('feedback.fieldShippedHint')}>
            <Input
              value={triageForm.shippedVersion}
              onChange={(e) => setTriageForm({ ...triageForm, shippedVersion: e.target.value })}
              placeholder="0.4.2"
              data-testid="triage-shipped"
            />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setTriageTarget(null)} disabled={triageSaving}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={submitTriage}
            loading={triageSaving}
            disabled={!issueNoValid}
            data-testid="triage-submit"
          >
            {t('common.save')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
