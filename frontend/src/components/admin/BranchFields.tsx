import { Field } from '@/components/ui/Field';

export interface BranchDraft {
  code: string;
  name: string;
  city: string;
  address: string;
}

export type BranchFieldErrors = Partial<Record<keyof BranchDraft, string>>;

/** Matches the scanner and the API: a code that cannot be scanned is not a code. */
export const BRANCH_CODE_PATTERN = /^[A-Z0-9_-]{2,32}$/;

export function validateBranch(draft: BranchDraft, options: { requireCode: boolean }): BranchFieldErrors {
  const problems: BranchFieldErrors = {};

  if (options.requireCode && !BRANCH_CODE_PATTERN.test(draft.code.trim().toUpperCase())) {
    problems.code = 'Use 2-32 letters, digits, hyphens or underscores.';
  }

  if (draft.name.trim().length < 2) {
    problems.name = 'Enter the branch name.';
  }

  return problems;
}

interface BranchFieldsProps {
  draft: BranchDraft;
  errors: BranchFieldErrors;
  disabled: boolean;
  /** False once the branch exists: its code is printed on every sticker. */
  editableCode: boolean;
  onChange: (changes: Partial<BranchDraft>) => void;
}

/** The branch's details, shared by the create and edit screens. */
export function BranchFields({ draft, errors, disabled, editableCode, onChange }: BranchFieldsProps) {
  return (
    <div className="flex flex-col gap-4">
      {editableCode ? (
        <Field
          label="Branch code"
          name="code"
          placeholder="BR001"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          required
          disabled={disabled}
          value={draft.code}
          onChange={(event) => onChange({ code: event.target.value })}
          error={errors.code}
          hint="Printed under the QR code, and carried inside it. It cannot be changed later."
          className="font-medium tracking-[0.08em] uppercase placeholder:font-normal"
        />
      ) : (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink-800">Branch code</span>
          <p className="min-h-touch rounded-xl bg-ink-50 px-4 py-3 text-base font-medium tracking-[0.08em] text-ink-700 ring-1 ring-ink-200/70">
            {draft.code}
          </p>
          <p className="text-sm text-ink-500">
            Fixed, because it is printed on every QR code already in use.
          </p>
        </div>
      )}

      <Field
        label="Branch name"
        name="name"
        placeholder="Surathkal Branch"
        required
        disabled={disabled}
        value={draft.name}
        onChange={(event) => onChange({ name: event.target.value })}
        error={errors.name}
      />

      <Field
        label="City"
        name="city"
        placeholder="Mangaluru"
        disabled={disabled}
        value={draft.city}
        onChange={(event) => onChange({ city: event.target.value })}
        hint="Optional. Shown to the customer beside the branch name."
      />

      <Field
        label="Address"
        name="address"
        placeholder="NH 66, Surathkal"
        disabled={disabled}
        value={draft.address}
        onChange={(event) => onChange({ address: event.target.value })}
        hint="Optional."
      />
    </div>
  );
}
