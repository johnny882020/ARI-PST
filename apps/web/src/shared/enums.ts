import { useQuery } from "@tanstack/react-query";
import { unwrap, type DiagnosisTerm, type Center } from "@ari/api-client";
import { api } from "../lib/api";
import { qk } from "../lib/query";
import { useLocale, useT } from "../app/locale";
import type { MessageKey } from "@ari/i18n";

export const ENUMS = {
  sampleType: ["ffpe", "frozen", "csf", "plasma_or_liquid_biopsy", "isolated_dna_rna"],
  availability: ["available", "limited", "depleted"],
  ageBand: ["0_lt1", "1_lt3", "3_lt6", "6_lt10", "10_lt15", "15_lt18"],
  timepoint: ["diagnosis", "during_treatment", "relapse"],
  sex: ["female", "male", "other_or_unknown"],
  attachedData: ["wes", "wgs", "rna_seq", "mri", "digital_pathology", "redcap_clinical"],
  consent: ["consent_obtained", "broad_consent", "waiver_by_committee", "restricted", "unknown"],
  quantity: ["small", "medium", "large"],
  staleness: ["fresh", "due_soon", "stale"],
} as const;
export type EnumGroup = keyof typeof ENUMS;

export function useEnumLabel() {
  const t = useT();
  return (group: EnumGroup, value: string | null | undefined): string => (value ? t(`enum.${group}.${value}` as MessageKey) : "");
}

export function useDiagnoses() {
  const { locale } = useLocale();
  const q = useQuery({ queryKey: qk.diagnoses, queryFn: () => unwrap(api.GET("/diagnoses")), staleTime: 3_600_000 });
  const terms: DiagnosisTerm[] = q.data?.items ?? [];
  const label = (code: string) => {
    const x = terms.find((d) => d.diagnosisCode === code);
    return x ? (locale === "he" ? x.labelHe : x.labelEn) : code;
  };
  return { terms, label, query: q };
}

export function useCenters() {
  const { locale } = useLocale();
  const q = useQuery({ queryKey: qk.centers, queryFn: () => unwrap(api.GET("/centers")), staleTime: 3_600_000 });
  const centers: Center[] = q.data?.items ?? [];
  const label = (id: string) => {
    const c = centers.find((x) => x.id === id);
    return c ? (locale === "he" ? c.nameHe : c.nameEn) : id;
  };
  return { centers, label, query: q };
}
