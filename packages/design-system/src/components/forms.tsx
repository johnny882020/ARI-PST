import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cx, Icon, Ltr, Spinner, useDesignSystem, VisuallyHidden } from "../core";
import { Button } from "./actions";

/* ---------- Field ---------- */
export interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  required?: boolean;
}

export interface FieldProps {
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  id?: string;
  className?: string;
  children: ReactNode | ((props: FieldControlProps) => ReactNode);
}

export function Field({ label, help, error, required, id, className, children }: FieldProps) {
  const { t } = useDesignSystem();
  const auto = useId();
  const fieldId = id ?? `f${auto}`;
  const helpId = help ? `${fieldId}-help` : undefined;
  const errId = error ? `${fieldId}-err` : undefined;
  const describedBy = [helpId, errId].filter(Boolean).join(" ") || undefined;
  const controlProps: FieldControlProps = {
    id: fieldId,
    "aria-describedby": describedBy,
    "aria-invalid": error ? true : undefined,
    required: required || undefined,
  };
  return (
    <div className={cx("ds-field", error && "ds-field-error", className)}>
      <label className="ds-label" htmlFor={fieldId}>
        {label}
        {required ? <span className="ds-required"> {t("common.required")}</span> : null}
      </label>
      {help ? (
        <div className="ds-help" id={helpId}>
          {help}
        </div>
      ) : null}
      {typeof children === "function" ? children(controlProps) : children}
      {error ? (
        <div className="ds-error" id={errId}>
          <Icon name="alert" size={16} /> <span>{error}</span>
        </div>
      ) : null}
    </div>
  );
}

interface FieldWrapProps {
  label?: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  fieldClassName?: string;
}

/* ---------- Input ---------- */
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size">, FieldWrapProps {}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, help, error, fieldClassName, className, required, id, ...rest },
  ref,
) {
  const control = (p?: FieldControlProps) => (
    <input
      ref={ref}
      className={cx("ds-control", className)}
      {...rest}
      {...(p ?? { id })}
      required={p ? p.required : required}
    />
  );
  if (label === undefined) return control();
  return (
    <Field label={label} help={help} error={error} required={required} id={id} className={fieldClassName}>
      {(p) => control(p)}
    </Field>
  );
});

/* ---------- Textarea ---------- */
export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, FieldWrapProps {
  /** Show "n / max" under the field. Not announced live. */
  showCount?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, help, error, fieldClassName, className, required, id, showCount, maxLength, value, defaultValue, onChange, ...rest },
  ref,
) {
  const [len, setLen] = useState(String(value ?? defaultValue ?? "").length);
  const control = (p?: FieldControlProps) => (
    <>
      <textarea
        ref={ref}
        className={cx("ds-control ds-textarea", className)}
        maxLength={maxLength}
        value={value}
        defaultValue={defaultValue}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
          setLen(e.target.value.length);
          onChange?.(e);
        }}
        {...rest}
        {...(p ?? { id })}
        required={p ? p.required : required}
      />
      {showCount ? (
        <div className="ds-count" aria-hidden="true">
          <Ltr>
            {value !== undefined ? String(value).length : len}
            {maxLength ? ` / ${maxLength}` : ""}
          </Ltr>
        </div>
      ) : null}
    </>
  );
  if (label === undefined) return control();
  return (
    <Field label={label} help={help} error={error} required={required} id={id} className={fieldClassName}>
      {(p) => control(p)}
    </Field>
  );
});

/* ---------- Select (native, styled) ---------- */
export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}
export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement>, FieldWrapProps {
  options?: SelectOption[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, help, error, fieldClassName, className, required, id, options, placeholder, children, ...rest },
  ref,
) {
  const control = (p?: FieldControlProps) => (
    <span className="ds-select-wrap">
      <select
        ref={ref}
        className={cx("ds-control ds-select", className)}
        {...rest}
        {...(p ?? { id })}
        required={p ? p.required : required}
      >
        {placeholder !== undefined ? (
          <option value="" disabled={required}>
            {placeholder}
          </option>
        ) : null}
        {options?.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
        {children}
      </select>
      <Icon name="sort" size={18} className="ds-select-icon" />
    </span>
  );
  if (label === undefined) return control();
  return (
    <Field label={label} help={help} error={error} required={required} id={id} className={fieldClassName}>
      {(p) => control(p)}
    </Field>
  );
});

/* ---------- Checkbox ---------- */
export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  indeterminate?: boolean;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, help, error, indeterminate, className, id, ...rest },
  ref,
) {
  const auto = useId();
  const cid = id ?? `c${auto}`;
  const inner = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (inner.current) inner.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  const describedBy = [help ? `${cid}-help` : "", error ? `${cid}-err` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cx("ds-choice", error && "ds-field-error", className)}>
      <label className="ds-choice-label" htmlFor={cid}>
        <input
          {...rest}
          id={cid}
          type="checkbox"
          className="ds-choice-input"
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          ref={(el) => {
            inner.current = el;
            if (typeof ref === "function") ref(el);
            else if (ref) ref.current = el;
          }}
        />
        <span className="ds-box" aria-hidden="true">
          <Icon name="check" size={16} className="ds-box-check" />
          <Icon name="dash" size={16} className="ds-box-dash" />
        </span>
        <span>{label}</span>
      </label>
      {help ? (
        <div className="ds-help ds-choice-help" id={`${cid}-help`}>
          {help}
        </div>
      ) : null}
      {error ? (
        <div className="ds-error ds-choice-help" id={`${cid}-err`}>
          <Icon name="alert" size={16} /> <span>{error}</span>
        </div>
      ) : null}
    </div>
  );
});

/* ---------- Switch ---------- */
export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size" | "role"> {
  label: ReactNode;
  help?: ReactNode;
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch(
  { label, help, className, id, ...rest },
  ref,
) {
  const auto = useId();
  const sid = id ?? `s${auto}`;
  return (
    <div className={cx("ds-choice", className)}>
      <label className="ds-choice-label" htmlFor={sid}>
        <input
          {...rest}
          ref={ref}
          id={sid}
          type="checkbox"
          role="switch"
          className="ds-choice-input"
          aria-describedby={help ? `${sid}-help` : undefined}
        />
        <span className="ds-switch-track" aria-hidden="true">
          <span className="ds-switch-thumb" />
        </span>
        <span>{label}</span>
      </label>
      {help ? (
        <div className="ds-help ds-choice-help" id={`${sid}-help`}>
          {help}
        </div>
      ) : null}
    </div>
  );
});

/* ---------- Radio ---------- */
interface RadioCtx {
  name: string;
  value?: string;
  onChange?: (v: string) => void;
  disabled?: boolean;
}
const RadioContext = createContext<RadioCtx | null>(null);

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "size"> {
  value: string;
  label: ReactNode;
  help?: ReactNode;
}

export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(
  { value, label, help, className, id, disabled, ...rest },
  ref,
) {
  const ctx = useContext(RadioContext);
  const auto = useId();
  const rid = id ?? `r${auto}`;
  return (
    <div className={cx("ds-choice", className)}>
      <label className="ds-choice-label" htmlFor={rid}>
        <input
          {...rest}
          ref={ref}
          id={rid}
          type="radio"
          className="ds-choice-input"
          name={ctx?.name ?? rest.name}
          value={value}
          checked={ctx ? ctx.value === value : rest.checked}
          disabled={disabled ?? ctx?.disabled}
          aria-describedby={help ? `${rid}-help` : undefined}
          onChange={(e) => {
            ctx?.onChange?.(value);
            rest.onChange?.(e);
          }}
        />
        <span className="ds-box ds-box-radio" aria-hidden="true">
          <span className="ds-radio-dot" />
        </span>
        <span>{label}</span>
      </label>
      {help ? (
        <div className="ds-help ds-choice-help" id={`${rid}-help`}>
          {help}
        </div>
      ) : null}
    </div>
  );
});

export interface RadioGroupOption {
  value: string;
  label: ReactNode;
  help?: ReactNode;
  disabled?: boolean;
}
export interface RadioGroupProps {
  legend: ReactNode;
  name: string;
  value?: string;
  onChange?: (value: string) => void;
  options?: RadioGroupOption[];
  help?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
}

export function RadioGroup({
  legend,
  name,
  value,
  onChange,
  options,
  help,
  error,
  required,
  disabled,
  className,
  children,
}: RadioGroupProps) {
  const { t } = useDesignSystem();
  const auto = useId();
  const describedBy = [help ? `${auto}-help` : "", error ? `${auto}-err` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <RadioContext.Provider value={{ name, value, onChange, disabled }}>
      <fieldset
        className={cx("ds-fieldset", error && "ds-field-error", className)}
        aria-describedby={describedBy}
        aria-required={required || undefined}
      >
        <legend className="ds-label">
          {legend}
          {required ? <span className="ds-required"> {t("common.required")}</span> : null}
        </legend>
        {help ? (
          <div className="ds-help" id={`${auto}-help`}>
            {help}
          </div>
        ) : null}
        {options?.map((o) => (
          <Radio key={o.value} value={o.value} label={o.label} help={o.help} disabled={o.disabled} />
        ))}
        {children}
        {error ? (
          <div className="ds-error" id={`${auto}-err`}>
            <Icon name="alert" size={16} /> <span>{error}</span>
          </div>
        ) : null}
      </fieldset>
    </RadioContext.Provider>
  );
}

/* ---------- SearchBox ---------- */
export interface SearchBoxProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  submitLabel?: string;
  loading?: boolean;
  /** Announced politely when it changes. Never pass raw record counts to roles that may not see them. */
  resultCount?: number | null;
  className?: string;
  name?: string;
}

export function SearchBox({
  label,
  value,
  onChange,
  onSubmit,
  placeholder,
  submitLabel,
  loading,
  resultCount,
  className,
  name,
}: SearchBoxProps) {
  const { t, locale } = useDesignSystem();
  const id = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit?.(value);
  };
  return (
    <form role="search" className={cx("ds-search", className)} onSubmit={submit} aria-label={label}>
      <label htmlFor={id} className="ds-vh">
        {label}
      </label>
      <div className="ds-search-box">
        <Icon name="search" size={20} className="ds-search-icon" />
        <input
          id={id}
          name={name}
          type="search"
          dir="auto"
          className="ds-search-input"
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          aria-busy={loading || undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        {loading ? <Spinner /> : null}
        <Button type="submit" variant="primary" size="sm">
          {submitLabel ?? t("common.search")}
        </Button>
      </div>
      <div className="ds-vh" role="status" aria-live="polite">
        {resultCount != null ? t("search.results", { count: new Intl.NumberFormat(locale === "he" ? "he-IL" : "en-US").format(resultCount) }) : ""}
      </div>
    </form>
  );
}

/* ---------- FacetFilter ---------- */
export interface FacetOption {
  value: string;
  label: ReactNode;
  /** number = exact (already k-screened by the server), null = suppressed, undefined = no count */
  count?: number | null;
  disabled?: boolean;
}
export interface FacetFilterProps {
  legend: ReactNode;
  options: FacetOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  className?: string;
}

export function FacetFilter({
  legend,
  options,
  selected,
  onChange,
  collapsible,
  defaultExpanded = true,
  className,
}: FacetFilterProps) {
  const { t, locale } = useDesignSystem();
  const [open, setOpen] = useState(defaultExpanded);
  const bodyId = useId();
  const fmt = new Intl.NumberFormat(locale === "he" ? "he-IL" : "en-US");
  const toggle = (v: string, on: boolean) =>
    onChange(on ? [...selected, v] : selected.filter((s) => s !== v));
  const list = (
    <div className="ds-facet-list">
      {options.map((o) => (
        <Checkbox
          key={o.value}
          checked={selected.includes(o.value)}
          disabled={o.disabled}
          onChange={(e) => toggle(o.value, e.target.checked)}
          label={
            <span className="ds-facet-row">
              <span>{o.label}</span>
              {o.count === null ? (
                <span className="ds-facet-count ds-facet-suppressed">
                  <span aria-hidden="true">—</span>
                  <VisuallyHidden>{t("counts.suppressed.sr")}</VisuallyHidden>
                </span>
              ) : o.count !== undefined ? (
                <span className="ds-facet-count">
                  <Ltr>{fmt.format(o.count)}</Ltr>
                </span>
              ) : null}
            </span>
          }
        />
      ))}
    </div>
  );
  if (!collapsible) {
    return (
      <fieldset className={cx("ds-fieldset ds-facet", className)}>
        <legend className="ds-facet-legend">{legend}</legend>
        {list}
      </fieldset>
    );
  }
  return (
    <div className={cx("ds-facet", className)}>
      <h3 className="ds-facet-heading">
        <button type="button" className="ds-facet-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
          <span>{legend}</span>
          <Icon name="chevron-end" size={18} className={cx("ds-facet-chev", open && "ds-open")} />
        </button>
      </h3>
      <div id={bodyId} hidden={!open}>
        <fieldset className="ds-fieldset">
          <legend className="ds-vh">{legend}</legend>
          {list}
        </fieldset>
      </div>
    </div>
  );
}
