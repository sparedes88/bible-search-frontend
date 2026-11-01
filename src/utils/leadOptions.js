import { format, isValid, parseISO } from "date-fns";

export const LEAD_OPTION_LISTS = [
  { id: "statuses", label: "Statuses", singular: "status", defaults: ["New", "Contacted", "Qualified", "Converted", "Closed"] },
  { id: "locations", field: "cityState", label: "City & State", singular: "city & state", defaults: [] },
  { id: "classTypes", field: "classType", label: "Class Types", singular: "class type", defaults: [] },
  { id: "programTypes", field: "programType", label: "Program Types", singular: "program type", defaults: [] },
];

export const LEAD_DETAIL_LISTS = LEAD_OPTION_LISTS.filter((list) => list.field);

export const formatLeadDisplayValue = (value) => {
  if (value == null) return "";
  if (typeof value !== "object") return String(value);
  const addressParts = [value.street, value.city, value.state, value.zip, value.country]
    .filter((part) => (typeof part === "string" && part.trim()) || typeof part === "number")
    .map(String);
  if (addressParts.length) return addressParts.join(", ");
  return Object.values(value)
    .filter((part) => typeof part === "string" || typeof part === "number")
    .map(String)
    .join(", ");
};

export const LEAD_MODULE_TABS = [
  { id: "statuses", label: "Statuses", path: "statuses" },
  { id: "locations", label: "City & State", path: "locations" },
  { id: "classTypes", label: "Class Types", path: "class-types" },
  { id: "programTypes", label: "Program Types", path: "program-types" },
  { id: "classInstances", label: "Class Instances", path: "class-instances" },
  { id: "manageClassInstances", label: "Create a Class", path: "manage-class-instances" },
  { id: "attendance", label: "Attendance", path: "attendance" },
];

export const getDefaultLeadOptions = () => ({
  ...Object.fromEntries(LEAD_OPTION_LISTS.map((list) => [list.id, [...list.defaults]])),
  classInstances: [],
});

export const EMPTY_LEAD_FORM = {
  name: "", phone: "", email: "", cityState: "", classType: "", programType: "", callbackTime: "",
  classInstanceId: "", classInstance: null,
};

export const isValidClassInstance = (instance) => Boolean(
  instance.name?.trim() && instance.classType?.trim()
  && /^\d{4}-\d{2}-\d{2}$/.test(instance.startDate || "")
  && isValid(parseISO(instance.startDate))
  && Number.isInteger(Number(instance.totalWeeks)) && Number(instance.totalWeeks) > 0
);

export const getClassInstanceLabel = (instance) => {
  const date = parseISO(instance.startDate || "");
  return `${instance.name} - ${isValid(date) ? format(date, "MMM d, yyyy") : "No start date"} (${instance.totalWeeks} weeks)`;
};

export const getLeadClassAssignment = (values, instances) => {
  if (!values.classInstanceId) return { classInstanceId: "", classInstance: null };
  const instance = instances.find((entry) => entry.id === values.classInstanceId && entry.classType === values.classType)
    || (values.classInstance?.id === values.classInstanceId ? values.classInstance : null);
  if (!instance || instance.classType !== values.classType) throw new Error("Select a class instance for the chosen class type");
  return { classInstanceId: instance.id, classInstance: {
    id: instance.id, name: instance.name, classType: instance.classType,
    startDate: instance.startDate, totalWeeks: Number(instance.totalWeeks),
  } };
};

export const getLeadLocation = (lead) => {
  const location = lead.cityState;
  if (location && typeof location === "object") {
    return [location.street, location.city, location.state, location.zip, location.country].filter(Boolean).join(", ");
  }
  return location ?? [lead.city, lead.state].filter(Boolean).join(", ");
};

export const findDuplicateLead = (candidate, leads) => {
  const normalizeName = (value) => String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
  const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
  const normalizePhone = (value) => {
    const digits = String(value || "").replace(/\D/g, "");
    return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  };
  const fields = [
    ["email", normalizeEmail], ["phone", normalizePhone], ["name", normalizeName],
  ];
  for (const [field, normalize] of fields) {
    const value = normalize(candidate[field]);
    if (!value) continue;
    const lead = leads.find((entry) => value === normalize(entry[field]));
    if (lead) return { lead, field };
  }
  return null;
};

export const getUpcomingLeadCalls = (leads, now = new Date()) => {
  const minuteStart = new Date(now);
  minuteStart.setSeconds(0, 0);
  return leads
    .filter((lead) => !lead.callbackCompleted && /^([01]\d|2[0-3]):[0-5]\d$/.test(lead.callbackTime || ""))
    .map((lead) => {
      const [hours, minutes] = lead.callbackTime.split(":").map(Number);
      const callAt = new Date(minuteStart);
      callAt.setHours(hours, minutes, 0, 0);
      if (callAt < minuteStart) callAt.setDate(callAt.getDate() + 1);
      return { lead, callAt };
    })
    .sort((first, second) => first.callAt - second.callAt || String(first.lead.name).localeCompare(String(second.lead.name)));
};