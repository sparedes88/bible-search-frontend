import React from "react";
import { Typography, Container, Box } from "@mui/material";

const ProfilePage = () => {
  return (
    <Container maxWidth="sm">
      <Box textAlign="center" mt={4}>
        <Typography variant="h4">Perfil del Usuario</Typography>
        {/* Add profile details here */}
      </Box>
    </Container>
  );
};

export default ProfilePage;