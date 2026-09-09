// Decision notes: the view root. All wiring lives in ./app/session (store, persistence,
// scheduler, notifier, lock, service worker) and ./app/router; this component reads the
// session's signals and renders the board, the banners from PLAN.md section 8, the sheet for
// the current route and the undo toast. Sheets render normally (not inline) and the patient
// sheet is keyed by patient id so its uncontrolled inputs never carry over between patients.
// A read-only tab renders the board and the lock banner only; every mutating route falls back
// to the board and the session ignores actions anyway. Export from the weekly nudge banner
// opens Settings when the chain ends in the textarea, since that is where the text renders.
import { currentTask } from '@domain/patient';
import { shiftBounds } from '@domain/stats';
import type { Patient } from '@domain/types';
import { AddPatientSheet } from './AddPatientSheet';
import { Banner } from './Banner';
import { Board } from './Board';
import { PatientSheet } from './PatientSheet';
import { Settings } from './Settings';
import { ShiftSummary } from './ShiftSummary';
import { Toast, TOAST_MAX_MS } from './Toast';
import { corruptMessage } from './app/notices';
import type { Route, Router } from './app/router';
import { canUndo } from './app/select';
import type { Session } from './app/session';
import { NUDGE_MESSAGE } from './app/transfer';

export interface AppProps {
  session: Session;
  router: Router;
}

/** "Shift from 04:00 Tue 10 Mar": the local start of the shift that contains `nowMs`. */
export function shiftLabel(nowMs: number): string {
  const { startMs } = shiftBounds(nowMs);
  const start = new Date(startMs);
  const day = start.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const hh = String(start.getHours()).padStart(2, '0');
  return `Shift from ${hh}:00 ${day}`;
}

/** Runs the export chain; a textarea outcome is shown in Settings, so open it if needed. */
function exportFrom(session: Session, router: Router): void {
  void session.actions.exportData().then((outcome) => {
    if (outcome === 'textarea' && router.route.peek().kind !== 'settings') {
      router.navigate({ kind: 'settings' });
    }
  });
}

interface NoticesProps {
  session: Session;
  router: Router;
}

function Notices({ session, router }: NoticesProps) {
  const { banners } = session;
  const storage = banners.storage.value;
  const corrupt = banners.corrupt.value;
  const transient = banners.transient.value;
  const lock = banners.lock.value;
  const updateReady = session.updateReady.value;
  const nudge = session.exportNudge.value;
  return (
    <div class="app__banners">
      {lock !== undefined && (
        <Banner
          message={lock}
          tone="warning"
          action={{
            label: 'Reload',
            onClick: () => {
              location.reload();
            },
          }}
        />
      )}
      {storage !== undefined && <Banner message={storage.message} tone="danger" />}
      {corrupt > 0 && (
        <Banner
          message={corruptMessage(corrupt)}
          tone="warning"
          action={{ label: 'Export raw records', onClick: session.exportRawCorrupt }}
          onDismiss={session.dismissCorrupt}
        />
      )}
      {updateReady && (
        <Banner
          message="Update ready"
          action={{ label: 'Reload', onClick: session.reloadForUpdate }}
        />
      )}
      {transient !== undefined && (
        <Banner message={transient} tone="warning" onDismiss={session.dismissTransient} />
      )}
      {nudge && (
        <Banner
          message={NUDGE_MESSAGE}
          action={{
            label: 'Export',
            onClick: () => {
              exportFrom(session, router);
            },
          }}
          onDismiss={session.dismissNudge}
        />
      )}
    </div>
  );
}

interface SheetProps {
  route: Route;
  session: Session;
  router: Router;
}

interface PatientRouteProps {
  patient: Patient;
  session: Session;
  router: Router;
}

function PatientRoute({ patient, session, router }: PatientRouteProps) {
  const state = session.state.value;
  const { actions } = session;
  return (
    <PatientSheet
      key={patient.id}
      patient={patient}
      now={state.now}
      currentTaskId={currentTask(patient)?.id}
      canUndo={canUndo(state, patient.id)}
      onComplete={(taskId) => {
        actions.complete(patient.id, taskId);
      }}
      onSkip={(taskId) => {
        actions.skip(patient.id, taskId);
      }}
      onUndo={() => {
        actions.undo(patient.id);
      }}
      onAddTask={(input, afterTaskId) => {
        actions.addTask(patient.id, input, afterTaskId);
      }}
      onSetNote={(taskId, note) => {
        actions.setNote(patient.id, taskId, note);
      }}
      onSetTheatreReturn={(returnedAt) => {
        actions.setTheatreReturn(patient.id, returnedAt);
      }}
      onDischarge={() => {
        actions.discharge(patient.id);
      }}
      onDelete={() => {
        actions.deletePatient(patient.id);
        router.close();
      }}
      onClose={router.close}
    />
  );
}

function RouteSheet({ route, session, router }: SheetProps) {
  const state = session.state.value;
  if (!session.ready.value || session.readOnly.value) {
    return null;
  }
  switch (route.kind) {
    case 'add':
      return (
        <AddPatientSheet
          showOwnerPhone={state.settings.showOwnerPhone}
          onSubmit={(form) => {
            session.actions.addPatient(form);
            router.close();
          }}
          onClose={router.close}
        />
      );
    case 'patient': {
      const patient = state.patients[route.id];
      return patient === undefined ? null : (
        <PatientRoute session={session} router={router} patient={patient} />
      );
    }
    case 'summary':
      return (
        <ShiftSummary
          stats={session.stats()}
          shiftLabel={shiftLabel(state.now)}
          onClose={router.close}
        />
      );
    case 'settings':
      return (
        <Settings
          settings={state.settings}
          notificationState={session.notificationState.value}
          storageMode={session.storageMode.value}
          version={session.version}
          onChange={session.actions.setSettings}
          onRequestNotifications={session.actions.requestNotifications}
          onExport={() => {
            exportFrom(session, router);
          }}
          onImportText={session.actions.importText}
          importError={session.importError.value}
          exportText={session.exportText.value}
          onDismissExportText={session.dismissTransfer}
          onPurge={session.actions.purgeDischarged}
          onDeleteAll={() => {
            session.actions.reset();
            session.dismissTransfer();
            router.close();
          }}
          onClose={() => {
            session.dismissTransfer();
            router.close();
          }}
        />
      );
    case 'board':
    case 'dev':
      return null;
  }
}

export function App({ session, router }: AppProps) {
  const state = session.state.value;
  const route = router.route.value;
  const readOnly = session.readOnly.value;
  const ready = session.ready.value;
  const toast = session.toast.value;
  const undoId = toast?.undoPatientId;
  const sheetOpen =
    ready &&
    !readOnly &&
    route.kind !== 'board' &&
    route.kind !== 'dev' &&
    (route.kind !== 'patient' || state.patients[route.id] !== undefined);

  return (
    <>
      <Board
        state={state}
        ready={ready}
        readOnly={readOnly}
        inert={sheetOpen}
        notices={<Notices session={session} router={router} />}
        onCompleteCurrent={session.actions.complete}
        onOpen={(patientId) => {
          router.navigate({ kind: 'patient', id: patientId });
        }}
        onAdd={() => {
          router.navigate({ kind: 'add' });
        }}
        onSummary={() => {
          router.navigate({ kind: 'summary' });
        }}
        onSettings={() => {
          router.navigate({ kind: 'settings' });
        }}
      />
      <RouteSheet route={route} session={session} router={router} />
      {toast !== undefined && (
        <div class="app__toast">
          <Toast
            key={toast.id}
            message={toast.message}
            durationMs={TOAST_MAX_MS}
            onExpire={session.dismissToast}
            onUndo={
              undoId === undefined
                ? undefined
                : () => {
                    session.actions.undo(undoId);
                  }
            }
          />
        </div>
      )}
    </>
  );
}
