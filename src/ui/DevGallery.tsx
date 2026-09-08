// Decision notes: the #/dev route (PLAN.md section 11 stage 4, "Storybook-free"). Every
// component renders in every state from the synthetic fixtures at a fixed clock so overdue
// and due-soon states are stable. Sheets render inline so the page scrolls and axe sees all
// of it at once. Current task ids are fixture facts written down here, not computed, because
// the UI never derives the current task. The patient sheet renders four times: the recovery
// patient with and without undo, the custom-task patient (task note) given a synthetic owner
// phone (tel: link), and the discharged patient (Discharge disabled with its time). The theme
// switch writes data-theme on <html>; a theme query parameter (search string or after the
// hash) preselects it.
import { validatePatientForm } from '@domain/validate';
import { templateTaskId, type Patient, type Theme } from '@domain/types';
import {
  FIXED_NOW_ISO,
  FIXED_NOW_MS,
  FIXTURE_SETTINGS,
  isoPlus,
  patientDischarged,
  patientFresh,
  patientInTheatre,
  patientPreOp,
  patientRecovery,
  patientWithCustomTask,
} from '@fixtures/synthetic';
import { type ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { AddPatientSheet } from './AddPatientSheet';
import { Banner } from './Banner';
import { Belt } from './Belt';
import { Chip } from './Chip';
import { PatientRow, type NextDue, type Urgency } from './PatientRow';
import { PatientSheet } from './PatientSheet';
import { Settings, type NotificationState } from './Settings';
import { ShiftSummary } from './ShiftSummary';
import { Toast } from './Toast';
import { applyTheme, readThemeParam } from './theme';

const THEMES: readonly Theme[] = ['system', 'light', 'dark'];
const noop = () => undefined;
const SYNTHETIC_PHONE = '+44 0000 000000';

interface Variant {
  title: string;
  patient: Patient;
  currentTaskId: string | undefined;
  urgency: Urgency;
  nextDue: NextDue | undefined;
}

function variants(): Variant[] {
  const custom = patientWithCustomTask();
  return [
    {
      title: 'Fresh admission',
      patient: patientFresh(),
      currentTaskId: templateTaskId('p-fresh', 'handover_admit'),
      urgency: 'intake',
      nextDue: undefined,
    },
    {
      title: 'Pre-op with a skip',
      patient: patientPreOp(),
      currentTaskId: templateTaskId('p-preop', 'premed'),
      urgency: 'none',
      nextDue: undefined,
    },
    {
      title: 'In theatre',
      patient: patientInTheatre(),
      currentTaskId: templateTaskId('p-theatre', 'in_theatre'),
      urgency: 'none',
      nextDue: undefined,
    },
    {
      title: 'Recovery with an overdue check',
      patient: patientRecovery(),
      currentTaskId: templateTaskId('p-recovery', 'check_1'),
      urgency: 'overdue',
      nextDue: {
        taskId: templateTaskId('p-recovery', 'check_1'),
        dueAt: isoPlus(FIXED_NOW_ISO, -5),
      },
    },
    {
      title: 'Custom task due soon',
      patient: custom,
      currentTaskId: templateTaskId('p-custom', 'check_1'),
      urgency: 'due_soon',
      nextDue: { taskId: 'p-custom:custom:1', dueAt: isoPlus(FIXED_NOW_ISO, 25) },
    },
    {
      title: 'Complete and discharged',
      patient: patientDischarged(),
      currentTaskId: undefined,
      urgency: 'none',
      nextDue: undefined,
    },
  ];
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ComponentChildren;
}) {
  return (
    <section class="gallery__section" id={id} aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>{title}</h2>
      {children}
    </section>
  );
}

const EMPTY_SUBMISSION = validatePatientForm({
  name: '',
  species: 'dog',
  breed: '',
  sex: 'unknown',
  weightKg: '',
  procedure: '',
  kennel: '',
  intake: 'none',
  notes: '',
});

const NOTIFICATION_STATES: readonly NotificationState[] = [
  'granted',
  'denied',
  'default',
  'unsupported',
];

export function DevGallery() {
  const [theme, setTheme] = useState<Theme>(readThemeParam);
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const items = variants();
  const recovery = items[3];
  const custom = items[4];
  const discharged = items[5];
  const sheetHandlers = {
    now: FIXED_NOW_MS,
    onComplete: noop,
    onSkip: noop,
    onUndo: noop,
    onAddTask: noop,
    onSetNote: noop,
    onSetTheatreReturn: noop,
    onDischarge: noop,
    onDelete: noop,
    onClose: noop,
    inline: true,
  };
  const stats = {
    tasksCompleted: 41,
    tasksSkipped: 3,
    checksOnTimePct: 87.5,
    bestStreak: 9,
    patientsAdmitted: 6,
    patientsDischarged: 4,
    medianAdmitToDischargeMin: 312,
  };
  const emptyStats = {
    tasksCompleted: 0,
    tasksSkipped: 0,
    checksOnTimePct: null,
    bestStreak: 0,
    patientsAdmitted: 0,
    patientsDischarged: 0,
    medianAdmitToDischargeMin: null,
  };
  const settingsCommon = {
    settings: FIXTURE_SETTINGS,
    version: 'gallery',
    onChange: noop,
    onRequestNotifications: noop,
    onExport: noop,
    onImportText: noop,
    onPurge: noop,
    onDeleteAll: noop,
    onClose: noop,
    inline: true,
  };

  return (
    <main class="gallery">
      <header class="gallery__header">
        <h1>Wardbelt gallery</h1>
        <div class="btn-row" role="group" aria-label="Theme">
          {THEMES.map((t) => (
            <button
              type="button"
              key={t}
              class={theme === t ? 'btn btn--primary' : 'btn'}
              aria-pressed={theme === t}
              onClick={() => {
                setTheme(t);
              }}
            >
              {t === 'system' ? 'System' : t === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>
      </header>

      <Section id="belt" title="Belt">
        {items.map((v) => (
          <div key={v.patient.id}>
            <h3 class="gallery__label">{v.title}</h3>
            <Belt tasks={v.patient.tasks} currentTaskId={v.currentTaskId} now={FIXED_NOW_MS} />
          </div>
        ))}
      </Section>

      <Section id="rows" title="Patient rows">
        <div class="gallery__rows">
          {items.map((v) => (
            <PatientRow
              key={v.patient.id}
              patient={v.patient}
              now={FIXED_NOW_MS}
              currentTaskId={v.currentTaskId}
              urgency={v.urgency}
              nextDue={v.nextDue}
              onCompleteCurrent={noop}
              onOpen={noop}
            />
          ))}
        </div>
      </Section>

      <Section id="sheet" title="Patient sheet">
        <div class="gallery__stack">
          {recovery !== undefined && (
            <>
              <h3 class="gallery__label">Undo available</h3>
              <PatientSheet
                {...sheetHandlers}
                patient={recovery.patient}
                currentTaskId={recovery.currentTaskId}
                canUndo
              />
              <h3 class="gallery__label">Nothing to undo</h3>
              <PatientSheet
                {...sheetHandlers}
                patient={recovery.patient}
                currentTaskId={recovery.currentTaskId}
                canUndo={false}
              />
            </>
          )}
          {custom !== undefined && (
            <>
              <h3 class="gallery__label">Custom task with a note, owner phone shown</h3>
              <PatientSheet
                {...sheetHandlers}
                patient={{ ...custom.patient, ownerPhone: SYNTHETIC_PHONE }}
                currentTaskId={custom.currentTaskId}
                canUndo
              />
            </>
          )}
          {discharged !== undefined && (
            <>
              <h3 class="gallery__label">Discharged</h3>
              <PatientSheet
                {...sheetHandlers}
                patient={discharged.patient}
                currentTaskId={discharged.currentTaskId}
                canUndo={false}
              />
            </>
          )}
        </div>
      </Section>

      <Section id="admit" title="Add patient">
        <div class="gallery__stack">
          <h3 class="gallery__label">With owner phone</h3>
          <AddPatientSheet showOwnerPhone onSubmit={noop} onClose={noop} inline />
          <h3 class="gallery__label">Without owner phone</h3>
          <AddPatientSheet showOwnerPhone={false} onSubmit={noop} onClose={noop} inline />
          <h3 class="gallery__label">Submitted empty</h3>
          <AddPatientSheet
            showOwnerPhone
            onSubmit={noop}
            onClose={noop}
            inline
            initialErrors={EMPTY_SUBMISSION.ok ? {} : EMPTY_SUBMISSION.errors}
          />
        </div>
      </Section>

      <Section id="summary" title="Shift summary">
        <div class="gallery__stack">
          <h3 class="gallery__label">With numbers</h3>
          <ShiftSummary
            stats={stats}
            shiftLabel="Tuesday 10 March, 04:00 to 04:00"
            onClose={noop}
            inline
          />
          <h3 class="gallery__label">Nothing measured</h3>
          <ShiftSummary stats={emptyStats} shiftLabel="Empty shift" onClose={noop} inline />
        </div>
      </Section>

      <Section id="settings" title="Settings">
        <div class="gallery__stack">
          {NOTIFICATION_STATES.map((state) => (
            <div key={state}>
              <h3 class="gallery__label">Notifications {state}, saving to this phone</h3>
              <Settings {...settingsCommon} notificationState={state} storageMode="idb" />
            </div>
          ))}
          <div>
            <h3 class="gallery__label">Storage unavailable</h3>
            <Settings {...settingsCommon} notificationState="granted" storageMode="memory" />
          </div>
        </div>
      </Section>

      <Section id="banner" title="Banner">
        <div class="gallery__stack">
          <Banner message="Not saving: storage unavailable" tone="danger" />
          <Banner
            message="2 records could not be read"
            tone="warning"
            onDismiss={noop}
            action={{ label: 'Export raw', onClick: noop }}
          />
          <Banner
            message="Update ready"
            action={{ label: 'Reload', onClick: noop }}
            onDismiss={noop}
          />
        </div>
      </Section>

      <Section id="toast" title="Toast">
        <div class="gallery__stack">
          <Toast
            message="Premed completed"
            durationMs={4000}
            onExpire={noop}
            onUndo={noop}
            inline
          />
          <Toast message="Exported" durationMs={4000} onExpire={noop} inline />
        </div>
      </Section>

      <Section id="chips" title="Chips">
        <div class="btn-row">
          <Chip>Neutral</Chip>
          <Chip tone="accent">Accent</Chip>
          <Chip tone="warning" mono>
            C2 in 04:12
          </Chip>
          <Chip tone="danger" mono>
            C1 overdue 03:10
          </Chip>
        </div>
      </Section>
    </main>
  );
}
