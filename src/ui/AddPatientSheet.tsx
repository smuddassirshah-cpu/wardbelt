// Decision notes: the admission form (PLAN.md section 7 fields). Inputs are uncontrolled and
// read with FormData at submit, then validated once with validatePatientForm; the sheet shows
// the validator's messages inline and hands the normalised form up. Species, sex and intake
// are segmented radio groups with the defaults preselected (dog, unknown, none) so a typical
// admission is name, procedure and Add. `initialErrors` lets the gallery show the error state.
import { SEXES, SPECIES, INTAKES, type PatientForm, type Sex } from '@domain/types';
import { validatePatientForm, type FieldErrors } from '@domain/validate';
import { type RefObject } from 'preact';
import { useId, useRef, useState } from 'preact/hooks';
import { Sheet } from './Sheet';
import { SPECIES_LABEL } from './format';

export interface AddPatientSheetProps {
  showOwnerPhone: boolean;
  onSubmit: (form: PatientForm) => void;
  onClose: () => void;
  inline?: boolean | undefined;
  initialErrors?: FieldErrors | undefined;
}

const SEX_SHORT: Readonly<Record<Sex, string>> = {
  M: 'M',
  MN: 'MN',
  F: 'F',
  FN: 'FN',
  unknown: 'Unknown',
};

interface TextFieldProps {
  id: string;
  name: keyof PatientForm;
  label: string;
  error: string | undefined;
  maxLength: number;
  required?: boolean;
  inputMode?: 'decimal' | 'tel';
  mono?: boolean;
  multiline?: boolean;
  inputRef?: RefObject<HTMLInputElement>;
}

function TextField(p: TextFieldProps) {
  const errorId = `${p.id}-error`;
  const shared = {
    id: p.id,
    name: p.name,
    class: p.mono ? 'field__input mono' : 'field__input',
    maxLength: p.maxLength,
    'aria-invalid': p.error !== undefined ? ('true' as const) : undefined,
    'aria-describedby': p.error !== undefined ? errorId : undefined,
    'aria-required': p.required === true ? ('true' as const) : undefined,
  };
  return (
    <div class="field">
      <label class="field__label" for={p.id}>
        {p.label}
        {p.required !== true && <span class="muted"> (optional)</span>}
      </label>
      {p.multiline === true ? (
        <textarea {...shared} />
      ) : (
        <input
          {...shared}
          ref={p.inputRef ?? null}
          type="text"
          autoComplete="off"
          inputMode={p.inputMode}
        />
      )}
      {p.error !== undefined && (
        <p class="field__error" id={errorId}>
          {p.error}
        </p>
      )}
    </div>
  );
}

interface ChoiceFieldProps<T extends string> {
  id: string;
  name: keyof PatientForm;
  legend: string;
  options: readonly T[];
  labels: (v: T) => string;
  defaultValue: T;
  error: string | undefined;
}

function ChoiceField<T extends string>(p: ChoiceFieldProps<T>) {
  const errorId = `${p.id}-error`;
  return (
    <fieldset
      class="field"
      aria-invalid={p.error !== undefined ? 'true' : undefined}
      aria-describedby={p.error !== undefined ? errorId : undefined}
    >
      <legend>{p.legend}</legend>
      <div class="seg">
        {p.options.map((v) => (
          <label class="seg__opt" key={v}>
            <input
              class="seg__input"
              type="radio"
              name={p.name}
              value={v}
              defaultChecked={v === p.defaultValue}
            />
            <span class="seg__text">{p.labels(v)}</span>
          </label>
        ))}
      </div>
      {p.error !== undefined && (
        <p class="field__error" id={errorId}>
          {p.error}
        </p>
      )}
    </fieldset>
  );
}

export function AddPatientSheet({
  showOwnerPhone,
  onSubmit,
  onClose,
  inline,
  initialErrors,
}: AddPatientSheetProps) {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<FieldErrors>(initialErrors ?? {});

  const submit = (e: Event) => {
    e.preventDefault();
    const el = form.current;
    if (el === null) {
      return;
    }
    const raw: Record<string, unknown> = {};
    new FormData(el).forEach((value, key) => {
      raw[key] = value;
    });
    const result = validatePatientForm(raw);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    onSubmit(result.value);
  };

  return (
    <Sheet title="Add patient" onClose={onClose} inline={inline} initialFocus={nameInput}>
      <form ref={form} onSubmit={submit} noValidate>
        {errors.form !== undefined && (
          <p class="error-line" role="alert">
            {errors.form}
          </p>
        )}
        <TextField
          id={`${id}-name`}
          name="name"
          label="Name"
          error={errors.name}
          maxLength={40}
          required
          inputRef={nameInput}
        />
        <ChoiceField
          id={`${id}-species`}
          name="species"
          legend="Species"
          options={SPECIES}
          labels={(v) => SPECIES_LABEL[v]}
          defaultValue="dog"
          error={errors.species}
        />
        <TextField
          id={`${id}-procedure`}
          name="procedure"
          label="Procedure"
          error={errors.procedure}
          maxLength={80}
          required
        />
        <ChoiceField
          id={`${id}-intake`}
          name="intake"
          legend="Intake slot"
          options={INTAKES}
          labels={(v) => (v === 'none' ? 'None' : v)}
          defaultValue="none"
          error={errors.intake}
        />
        <TextField
          id={`${id}-kennel`}
          name="kennel"
          label="Kennel"
          error={errors.kennel}
          maxLength={10}
          mono
        />
        <ChoiceField
          id={`${id}-sex`}
          name="sex"
          legend="Sex"
          options={SEXES}
          labels={(v) => SEX_SHORT[v]}
          defaultValue="unknown"
          error={errors.sex}
        />
        <TextField
          id={`${id}-breed`}
          name="breed"
          label="Breed"
          error={errors.breed}
          maxLength={40}
        />
        <TextField
          id={`${id}-weight`}
          name="weightKg"
          label="Weight in kg"
          error={errors.weightKg}
          maxLength={7}
          inputMode="decimal"
          mono
        />
        {showOwnerPhone && (
          <TextField
            id={`${id}-phone`}
            name="ownerPhone"
            label="Owner phone"
            error={errors.ownerPhone}
            maxLength={20}
            inputMode="tel"
            mono
          />
        )}
        <TextField
          id={`${id}-notes`}
          name="notes"
          label="Notes"
          error={errors.notes}
          maxLength={500}
          multiline
        />
        <div class="btn-row">
          <button type="submit" class="btn btn--primary">
            Add patient
          </button>
          <button type="button" class="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Sheet>
  );
}
