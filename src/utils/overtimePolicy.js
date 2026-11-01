import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";

export const DEFAULT_OVERTIME_POLICY = {
  baseRate: 90,
  overtimeMultiplier: 1.5,
  thresholdHours: 40,
};

export const getOvertimePolicyLabel = (policy = DEFAULT_OVERTIME_POLICY) => {
  const baseRate = Number(policy.baseRate) || 0;
  const multiplier = Number(policy.overtimeMultiplier) || DEFAULT_OVERTIME_POLICY.overtimeMultiplier;
  const thresholdHours = Number(policy.thresholdHours) || DEFAULT_OVERTIME_POLICY.thresholdHours;
  const overtimeRate = baseRate * multiplier;
  return `OT after ${thresholdHours}h/user/week @ $${overtimeRate}/h`;
};

export const getOvertimePolicyRef = (churchId) => (
  churchId ? doc(db, "churches", churchId, "invoiceSettings", "overtimePolicy") : null
);

// Live org-wide overtime policy; falls back to defaults until loaded or if unset.
export const useOvertimePolicy = (churchId) => {
  const [policy, setPolicy] = useState(DEFAULT_OVERTIME_POLICY);

  useEffect(() => {
    const ref = getOvertimePolicyRef(churchId);
    if (!ref) {
      setPolicy(DEFAULT_OVERTIME_POLICY);
      return undefined;
    }
    return onSnapshot(ref, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() || {};
        setPolicy({
          baseRate: Number(data.baseRate) || DEFAULT_OVERTIME_POLICY.baseRate,
          overtimeMultiplier: Number(data.overtimeMultiplier) || DEFAULT_OVERTIME_POLICY.overtimeMultiplier,
          thresholdHours: Number(data.thresholdHours) || DEFAULT_OVERTIME_POLICY.thresholdHours,
        });
      } else {
        setPolicy(DEFAULT_OVERTIME_POLICY);
      }
    }, (error) => {
      console.error("Failed to load overtime policy:", error);
      setPolicy(DEFAULT_OVERTIME_POLICY);
    });
  }, [churchId]);

  return policy;
};
