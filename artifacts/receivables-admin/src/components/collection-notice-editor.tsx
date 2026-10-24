import { Field } from '@/components/kit';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { ApprovalDraft } from '@/lib/approval-drafts';

type NoticeKind = 'collectNow' | 'extension';
type NoticeField = 'noticeEn' | 'noticeMs';

export function CollectionNoticeEditor({ draft, kind, editable, onKindChange, onChange }: {
  draft: ApprovalDraft;
  kind: NoticeKind;
  editable: boolean;
  onKindChange: (kind: NoticeKind) => void;
  onChange: (kind: NoticeKind, field: NoticeField, value: string) => void;
}) {
  const viewed = draft.noticeVariants?.[kind];
  return <div className="space-y-3">
    {draft.noticeVariants && <div className="space-y-2">
      <Field label="View / edit notice variant" hint="Viewing a variant does not change the collection decision. The collection method determines which approved variant is sent.">
        <Select value={kind} onValueChange={value => {
          if (value === 'collectNow' || value === 'extension') onKindChange(value);
        }}>
          <SelectTrigger className="sm:w-72" data-testid={`select-notice-variant-${draft.id}`}><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="collectNow">Immediate collection</SelectItem><SelectItem value="extension">Negotiable extension</SelectItem></SelectContent>
        </Select>
      </Field>
      <p className="text-xs text-muted-foreground">Send: {draft.method === 'Extension negotiation' ? 'Negotiable extension' : 'Immediate collection'} · EN: {viewed?.noticeEnSource} / MS: {viewed?.noticeMsSource} · {draft.noticeVariants.reasonCode}. AI adds a validated contextual paragraph; invoice facts and proposed terms remain controlled.</p>
    </div>}
    <div className="grid gap-3 md:grid-cols-2">
      <Field label="Notice (English)"><Textarea rows={7} maxLength={10000} value={viewed?.noticeEn ?? draft.noticeEn}
        onChange={event => onChange(kind, 'noticeEn', event.target.value)} disabled={!editable} data-testid={`input-notice-en-${draft.id}`} /></Field>
      <Field label="Notis (Bahasa Melayu)"><Textarea rows={7} maxLength={10000} value={viewed?.noticeMs ?? draft.noticeMs}
        onChange={event => onChange(kind, 'noticeMs', event.target.value)} disabled={!editable} data-testid={`input-notice-ms-${draft.id}`} /></Field>
    </div>
  </div>;
}
