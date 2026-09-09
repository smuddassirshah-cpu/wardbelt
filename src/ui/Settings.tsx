// Decision notes: settings are edited field by field through onChange(partial). The
// notification toggle is disabled when the browser has denied or cannot support notifications,
// and turning it on while permission is still undecided also asks for it. Import reads the
// chosen file with file.text() (FileReader fallback) and hands the text up unparsed; the
// caller validates it (PLAN.md section 7) and hands back `importError` to show inline, next
// to the file it concerns. `exportText` is the last resort of the export chain (section 8): a
// read-only textarea that selects itself on focus so the JSON can be copied by hand. Delete
// everything is an inline two-step confirm.
import { type Settings as SettingsRecord, type Theme } from '@domain/types';
import { useId, useRef, useState } from 'preact/hooks';
import { ConfirmButton } from './ConfirmButton';
import { Sheet } from './Sheet';

export type NotificationState = 'granted' | 'denied' | 'default' | 'unsupported';
export type StorageMode = 'idb' | 'memory';

export interface SettingsProps {
  settings: SettingsRecord;
  notificationState: NotificationState;
  storageMode: StorageMode;
  version: string;
  onChange: (partial: Partial<SettingsRecord>) => void;
  onRequestNotifications: () => void;
  onExport: () => void;
  onImportText: (text: string) => void;
  onPurge: () => void;
  onDeleteAll: () => void;
  onClose: () => void;
  inline?: boolean | undefined;
  /** Rejection message from the last import attempt, shown next to the Import button. */
  importError?: string | undefined;
  /** Export JSON to show in a copyable textarea when it could not be shared or saved. */
  exportText?: string | undefined;
  onDismissExportText?: (() => void) | undefined;
}

const THEMES: readonly Theme[] = ['system', 'light', 'dark'];
const PURGE_MIN = 1;
const PURGE_MAX = 365;

export const NOTIFICATION_HINT: Readonly<Record<NotificationState, string>> = {
  granted: 'Allowed. Overdue checks show a notification while the app is open.',
  denied: 'Blocked in browser settings. Vibration still works.',
  default: 'The browser will ask for permission when you turn this on.',
  unsupported: 'Not supported on this browser. Vibration still works.',
};

export const STORAGE_LINE: Readonly<Record<StorageMode, string>> = {
  idb: 'Saving to this phone',
  memory: 'Not saving: storage unavailable',
};

export const EXPORT_TEXT_LABEL = 'The file could not be saved. Copy this text instead';

function days(n: number): string {
  return `${n} day${n === 1 ? '' : 's'}`;
}

interface TextBlob {
  text?: () => Promise<string>;
}

function readFile(file: File): Promise<string> {
  const blob: TextBlob = file;
  if (typeof blob.text === 'function') {
    return blob.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('Could not read the file'));
    };
    reader.readAsText(file);
  });
}

interface ToggleProps {
  id: string;
  label: string;
  hint?: string | undefined;
  checked: boolean;
  disabled?: boolean;
  onToggle: (checked: boolean) => void;
}

function Toggle({ id, label, hint, checked, disabled = false, onToggle }: ToggleProps) {
  const hintId = `${id}-hint`;
  return (
    <label class="toggle" for={id}>
      <input
        id={id}
        class="toggle__input"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={hint === undefined ? undefined : hintId}
        onChange={(e) => {
          onToggle(e.currentTarget.checked);
        }}
      />
      <span class="toggle__text">
        {label}
        {hint !== undefined && (
          <span class="toggle__hint" id={hintId}>
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}

export function Settings(props: SettingsProps) {
  const {
    settings,
    notificationState,
    storageMode,
    version,
    onChange,
    onRequestNotifications,
    onExport,
    onImportText,
    onPurge,
    onDeleteAll,
    onClose,
    inline,
    importError,
    exportText,
    onDismissExportText,
  } = props;
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [purgeError, setPurgeError] = useState<string | undefined>(undefined);
  const [readError, setReadError] = useState<string | undefined>(undefined);
  const purgeId = `${id}-purge`;
  const exportId = `${id}-export`;
  const importMessage = importError ?? readError;
  const notificationsBlocked =
    notificationState === 'denied' || notificationState === 'unsupported';

  const onPurgeDays = (raw: string) => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < PURGE_MIN || n > PURGE_MAX) {
      setPurgeError(`Between ${PURGE_MIN} and ${PURGE_MAX} days`);
      return;
    }
    setPurgeError(undefined);
    onChange({ purgeDays: n });
  };

  const onFileChosen = (input: HTMLInputElement) => {
    const file = input.files?.[0];
    if (file === undefined) {
      return;
    }
    setReadError(undefined);
    readFile(file)
      .then((text) => {
        onImportText(text);
      })
      .catch(() => {
        setReadError('Could not read that file');
      })
      .finally(() => {
        input.value = '';
      });
  };

  return (
    <Sheet title="Settings" onClose={onClose} inline={inline}>
      <section class="section" aria-label="Alerts">
        <Toggle
          id={`${id}-notifications`}
          label="Notifications"
          hint={NOTIFICATION_HINT[notificationState]}
          checked={settings.notifications && !notificationsBlocked}
          disabled={notificationsBlocked}
          onToggle={(checked) => {
            onChange({ notifications: checked });
            if (checked && notificationState === 'default') {
              onRequestNotifications();
            }
          }}
        />
        <Toggle
          id={`${id}-sound`}
          label="Click on completion"
          hint="A short click each time a task is completed."
          checked={settings.sound}
          onToggle={(checked) => {
            onChange({ sound: checked });
          }}
        />
        <Toggle
          id={`${id}-phone`}
          label="Show owner phone field"
          hint="Adds an optional owner phone number to the admission form for tap to call."
          checked={settings.showOwnerPhone}
          onToggle={(checked) => {
            onChange({ showOwnerPhone: checked });
          }}
        />
      </section>

      <section class="section" aria-label="Appearance">
        <fieldset class="field">
          <legend>Theme</legend>
          <div class="seg">
            {THEMES.map((t) => (
              <label class="seg__opt" key={t}>
                <input
                  class="seg__input"
                  type="radio"
                  name={`${id}-theme`}
                  value={t}
                  checked={settings.theme === t}
                  onChange={() => {
                    onChange({ theme: t });
                  }}
                />
                <span class="seg__text">
                  {t === 'system' ? 'System' : t === 'light' ? 'Light' : 'Dark'}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section class="section" aria-label="Data">
        <div class="field">
          <label class="field__label" for={purgeId}>
            Keep discharged patients for (days)
          </label>
          <input
            id={purgeId}
            class="field__input mono"
            type="number"
            inputMode="numeric"
            min={PURGE_MIN}
            max={PURGE_MAX}
            step={1}
            defaultValue={String(settings.purgeDays)}
            aria-invalid={purgeError !== undefined ? 'true' : undefined}
            aria-describedby={purgeError !== undefined ? `${purgeId}-error` : undefined}
            onChange={(e) => {
              onPurgeDays(e.currentTarget.value);
            }}
          />
          {purgeError !== undefined && (
            <p class="field__error" id={`${purgeId}-error`}>
              {purgeError}
            </p>
          )}
        </div>
        <div class="btn-row">
          <button type="button" class="btn" onClick={onPurge}>
            Purge discharged older than {days(settings.purgeDays)}
          </button>
        </div>
      </section>

      <section class="section" aria-label="Backup">
        <div class="btn-row">
          <button type="button" class="btn btn--primary" onClick={onExport}>
            Export
          </button>
          <button
            type="button"
            class="btn"
            onClick={() => {
              fileInput.current?.click();
            }}
          >
            Import
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              onFileChosen(e.currentTarget);
            }}
          />
        </div>
        {importMessage !== undefined && (
          <p class="error-line" role="alert">
            {importMessage}
          </p>
        )}
        {exportText !== undefined && (
          <div class="field">
            <label class="field__label" for={exportId}>
              {EXPORT_TEXT_LABEL}
            </label>
            <textarea
              id={exportId}
              class="field__input mono"
              readOnly
              rows={8}
              value={exportText}
              onFocus={(e) => {
                e.currentTarget.select();
              }}
            />
            <div class="btn-row">
              <button type="button" class="btn" onClick={onDismissExportText}>
                Done
              </button>
            </div>
          </div>
        )}
        <p class="field__hint">
          {settings.lastExportAt === undefined
            ? 'Never exported.'
            : `Last export ${new Date(settings.lastExportAt).toLocaleString('en-GB')}.`}
        </p>
      </section>

      <section class="section" aria-label="Delete">
        <ConfirmButton
          label="Delete everything"
          confirmLabel="Confirm delete everything"
          onConfirm={onDeleteAll}
        />
      </section>

      <section class="section" aria-label="About">
        <p class="summary-line">{STORAGE_LINE[storageMode]}</p>
        <p class="summary-line">Version {version}</p>
      </section>
    </Sheet>
  );
}
