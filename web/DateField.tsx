import { MonthPicker } from './MonthPicker';
export function DateField({
  id,
  label,
  value,
  onChange,
  min,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  error?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <MonthPicker
        id={id}
        controlLabel={label}
        className="payment-month"
        month={value.slice(0, 7)}
        date={value}
        direction={1}
        onChange={() => undefined}
        onDateChange={onChange}
        min={min}
      />
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
