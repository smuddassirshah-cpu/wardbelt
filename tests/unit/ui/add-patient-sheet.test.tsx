import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddPatientSheet } from '../../../src/ui/AddPatientSheet';
import { validatePatientForm } from '../../../src/domain/validate';

afterEach(cleanup);

function type(label: string | RegExp, value: string) {
  fireEvent.input(screen.getByLabelText(label), { target: { value } });
}

describe('AddPatientSheet', () => {
  it('renders every section 7 field with defaults and focuses the name', () => {
    render(<AddPatientSheet showOwnerPhone onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Add patient' })).toBeTruthy();
    const name = screen.getByLabelText<HTMLInputElement>('Name');
    expect(document.activeElement).toBe(name);
    expect(name.maxLength).toBe(40);
    expect(name.getAttribute('aria-required')).toBe('true');
    expect(screen.getByLabelText<HTMLInputElement>(/^Procedure/).maxLength).toBe(80);
    expect(screen.getByLabelText<HTMLInputElement>(/^Breed/).maxLength).toBe(40);
    expect(screen.getByLabelText<HTMLInputElement>(/^Kennel/).maxLength).toBe(10);
    expect(screen.getByLabelText<HTMLTextAreaElement>(/^Notes/).maxLength).toBe(500);
    const weight = screen.getByLabelText(/^Weight/);
    expect(weight.getAttribute('inputmode')).toBe('decimal');
    const phone = screen.getByLabelText<HTMLInputElement>(/^Owner phone/);
    expect(phone.getAttribute('inputmode')).toBe('tel');
    expect(phone.maxLength).toBe(20);
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Dog' }).checked).toBe(true);
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Unknown' }).checked).toBe(true);
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'None' }).checked).toBe(true);
    expect(screen.getAllByRole('radio')).toHaveLength(4 + 5 + 4);
    expect(screen.getByRole('group', { name: 'Species' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Sex' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Intake slot' })).toBeTruthy();
  });

  it('hides the owner phone field unless enabled', () => {
    render(<AddPatientSheet showOwnerPhone={false} onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByLabelText(/^Owner phone/)).toBeNull();
  });

  it('submits the normalised form for a minimal admission', () => {
    const onSubmit = vi.fn();
    render(<AddPatientSheet showOwnerPhone={false} onSubmit={onSubmit} onClose={vi.fn()} />);
    type('Name', '  Fixture Five ');
    type(/^Procedure/, 'Castrate');
    fireEvent.click(screen.getByRole('button', { name: 'Add patient' }));
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Fixture Five',
      species: 'dog',
      breed: '',
      sex: 'unknown',
      procedure: 'Castrate',
      kennel: '',
      intake: 'none',
      notes: '',
    });
  });

  it('submits every field normalised for a full admission', () => {
    const onSubmit = vi.fn();
    render(<AddPatientSheet showOwnerPhone onSubmit={onSubmit} onClose={vi.fn()} />);
    type('Name', 'Fixture Six');
    fireEvent.click(screen.getByRole('radio', { name: 'Cat' }));
    type(/^Breed/, 'Domestic shorthair');
    fireEvent.click(screen.getByRole('radio', { name: 'FN' }));
    type(/^Weight/, '4.256');
    type(/^Procedure/, 'Dental');
    type(/^Kennel/, 'C3');
    fireEvent.click(screen.getByRole('radio', { name: '10:00' }));
    type(/^Owner phone/, '+44 0000 000000');
    type(/^Notes/, 'Nervous handler required');
    fireEvent.click(screen.getByRole('button', { name: 'Add patient' }));
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Fixture Six',
      species: 'cat',
      breed: 'Domestic shorthair',
      sex: 'FN',
      weightKg: 4.26,
      procedure: 'Dental',
      kennel: 'C3',
      intake: '10:00',
      ownerPhone: '+44 0000 000000',
      notes: 'Nervous handler required',
    });
  });

  it('shows every section 7 error for a bad submission with aria wiring', () => {
    const onSubmit = vi.fn();
    render(<AddPatientSheet showOwnerPhone onSubmit={onSubmit} onClose={vi.fn()} />);
    type('Name', 'x'.repeat(41));
    type(/^Breed/, 'y'.repeat(41));
    type(/^Weight/, 'heavy');
    type(/^Kennel/, 'k'.repeat(11));
    type(/^Owner phone/, '12');
    type(/^Notes/, 'n'.repeat(501));
    fireEvent.click(screen.getByRole('button', { name: 'Add patient' }));
    expect(onSubmit).not.toHaveBeenCalled();
    const expected: Record<string, string> = {
      Name: 'At most 40 characters',
      Breed: 'At most 40 characters',
      Weight: 'Must be a number',
      Procedure: 'Required',
      Kennel: 'At most 10 characters',
      'Owner phone': 'Between 6 and 20 characters',
      Notes: 'At most 500 characters',
    };
    for (const [label, message] of Object.entries(expected)) {
      const input = screen.getByLabelText(new RegExp(`^${label}`));
      expect(input.getAttribute('aria-invalid'), label).toBe('true');
      const id = input.getAttribute('aria-describedby') ?? '';
      expect(document.getElementById(id)?.textContent, label).toBe(message);
    }
    type(/^Weight/, '200');
    fireEvent.click(screen.getByRole('button', { name: 'Add patient' }));
    expect(screen.getByText('Between 0.05 and 150 kg')).toBeTruthy();
    type(/^Owner phone/, '01234 abc');
    fireEvent.click(screen.getByRole('button', { name: 'Add patient' }));
    expect(screen.getByText('Digits, spaces and + only')).toBeTruthy();
  });

  it('clears errors after a corrected submission', () => {
    const onSubmit = vi.fn();
    render(<AddPatientSheet showOwnerPhone={false} onSubmit={onSubmit} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add patient' }));
    expect(screen.getAllByText('Required')).toHaveLength(2);
    type('Name', 'Fixture Seven');
    type(/^Procedure/, 'Spay');
    fireEvent.click(screen.getByRole('button', { name: 'Add patient' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Required')).toBeNull();
  });

  it('shows initialErrors, including a form-level one, and closes via Cancel and Close', () => {
    const onClose = vi.fn();
    const empty = validatePatientForm({});
    render(
      <AddPatientSheet
        showOwnerPhone
        onSubmit={vi.fn()}
        onClose={onClose}
        inline
        initialErrors={{ ...(empty.ok ? {} : empty.errors), form: 'Invalid form' }}
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe('Invalid form');
    expect(screen.getByRole('group', { name: 'Species' }).getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(screen.getAllByText('Required').length).toBeGreaterThanOrEqual(2);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
