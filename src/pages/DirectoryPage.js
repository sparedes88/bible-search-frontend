import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { searchChurchById } from "../api";
import commonStyles from "./commonStyles";

const DirectoryPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [church, setChurch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tapCount, setTapCount] = useState(0);

  useEffect(() => {
    const fetchData = async () => {
      const churchData = await searchChurchById(id);
      setChurch(churchData);
      setLoading(false);
    };
    fetchData();
  }, [id]);

  // Detect 4 taps on the logo
  const handleLogoTap = () => {
    setTapCount(prev => prev + 1);
    if (tapCount + 1 === 4) {
      navigate("/");
      setTapCount(0);
    }
  };

  return (
    <div style={commonStyles.container}>
      <div style={commonStyles.banner}>
        {loading ? <Skeleton height={300} /> : <img src={`https://iglesia-tech-api.e2api.com${church.portadaArticulos}`} alt="Church Banner" style={commonStyles.bannerImage} />}
      </div>

      <div style={commonStyles.logoContainer} onClick={handleLogoTap}>
        {loading ? <Skeleton circle height={90} width={90} /> : <img src={`https://iglesia-tech-api.e2api.com${church.Logo}`} alt="Church Logo" style={commonStyles.logo} />}
      </div>

      <button onClick={() => navigate(-1)} style={commonStyles.backButton}>⬅ Back</button>

      {loading ? <Skeleton height={30} width="60%" style={{ margin: "10px auto" }} /> : <h2 style={commonStyles.title}>📖 Church Directory</h2>}

      <div style={commonStyles.sectionContainer}>
        {loading ? <Skeleton count={4} /> : <p>Directory for Church ID: {id}</p>}
      </div>
    </div>
  );
};

export default DirectoryPage;
