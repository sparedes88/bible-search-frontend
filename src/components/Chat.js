import React from "react";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import GroupList from "./GroupList";
import Chat from "./Chat";

const App = () => {
  return (
    <Router>
      <Routes>
        <Route path="/groups" element={<GroupList />} />
        <Route path="/chat/:groupId" element={<Chat />} />
      </Routes>
    </Router>
  );
};

export default App;