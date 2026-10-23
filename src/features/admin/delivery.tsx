import { Pill } from '@/components/ui';
import type { OutboxRow } from '@/lib/types';

export const EVENT_LABEL: Record<string, string> = {
  job_requested: 'Nowe zgłoszenie',
  job_withdrawn: 'Wycofanie zgłoszenia',
  job_confirmed: 'Potwierdzenie montażu',
  job_rejected: 'Odrzucenie zgłoszenia',
  job_cancelled: 'Anulowanie montażu',
  job_rescheduled: 'Zmiana terminu',
  job_completed: 'Zakończenie montażu',
  date_released: 'Zwolniony termin',
  announcement: 'Ogłoszenie o terminie',
  invitation: 'Zaproszenie',
};

const STATUS: Record<OutboxRow['status'], { label: string; tone: 'neutral' | 'info' | 'warning' | 'danger' | 'success' }> = {
  queued: { label: 'W kolejce', tone: 'neutral' },
  sending: { label: 'Wysyłanie', tone: 'info' },
  sent: { label: 'Wysłano', tone: 'success' },
  failed: { label: 'Błąd wysyłki', tone: 'danger' },
  mocked: { label: 'Tryb testowy – nie wysłano', tone: 'warning' },
};

export function DeliveryStatus({ status }: { status: OutboxRow['status'] }) {
  return <Pill text={STATUS[status].label} tone={STATUS[status].tone} />;
}
