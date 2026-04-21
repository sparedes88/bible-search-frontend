import { createContext } from "react";

const AssigneeOptionsContext = createContext({ assigneeOptions: [], setAssigneeOptions: () => {} });

export default AssigneeOptionsContext;
