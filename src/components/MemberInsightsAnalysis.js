import React, { useState, useEffect, useRef } from 'react';
import { FaLightbulb, FaHeart, FaCrown, FaUserCheck, FaCommentDots, FaCircle, FaUser, FaChartPie } from 'react-icons/fa';
import './MemberInsightsAnalysis.css';
import axios from 'axios';

const MemberInsightsAnalysis = ({ memberData, notesData }) => {
  const [insights, setInsights] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showFullReport, setShowFullReport] = useState(false);

  useEffect(() => {
    if (memberData && notesData && notesData.length > 0) {
      generateInsights();
    }
  }, [memberData, notesData]);

  const generateInsights = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Prepare the notes text for analysis
      const notesText = notesData.map(note => note.text).join('\n');
      
      // If no notes text available, provide placeholder insights
      if (!notesText.trim()) {
        setInsights(generatePlaceholderInsights());
        setIsLoading(false);
        return;
      }

      // Prepare the prompt for OpenAI
      const prompt = `
      Based on the following notes about a church member, analyze and identify:
      1. Their primary personality traits (top 3-5)
      2. Their leadership style and potential (if applicable)
      3. Their likely top 2 love languages based on Gary Chapman's 5 love languages (Words of Affirmation, Acts of Service, Receiving Gifts, Quality Time, Physical Touch)
      4. Key spiritual gifts or areas they might excel at in ministry
      5. How the church can best serve and engage this person

      Notes about the member:
      ${notesText}

      Format the response as JSON with the following structure:
      {
        "personalityTraits": [{"trait": "string", "description": "string", "confidence": number}],
        "leadershipStyle": {"primary": "string", "description": "string", "potential": number},
        "loveLanguages": [{"language": "string", "description": "string", "confidence": number}],
        "spiritualGifts": [{"gift": "string", "description": "string", "confidence": number}],
        "purposeDrivenCategory": [{"category": "string", "description": "string", "confidence": number, "scriptureReference": "string", "ministryRecommendations": ["string"]}],
        "fiveFoldMinistry": {"primaryGift": "string", "description": "string", "confidence": number, "scriptureReference": "string", "explanation": "string"},
        "engagementSuggestions": [{"suggestion": "string", "reason": "string"}],
        "summary": "string"
      }
      
      Each confidence value should be from 0-100 based on how strongly the notes suggest that trait.
      If there's insufficient data for any section, include a note about it in the response.
      `;

      // Call OpenAI API (This would be a real API call in production)
      // For demo/testing purposes, we'll use a simulated response for now
      // You would replace this with an actual API call in production
      
      // Simulated API call delay
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Generate insights based on notes content to simulate AI analysis
      const simulatedInsights = generateSimulatedInsights(notesText, memberData.name);
      setInsights(simulatedInsights);

      setIsLoading(false);
    } catch (err) {
      console.error('Error generating insights:', err);
      setError('Failed to generate insights. Please try again later.');
      setIsLoading(false);
    }
  };

  const generateSimulatedInsights = (notesText, memberName) => {
    // This function simulates what OpenAI would return based on the notes content
    // In production, this would be replaced with the actual API response
    
    const lowercaseNotes = notesText.toLowerCase();
    
    // Simple keyword matching to create somewhat meaningful simulated insights
    const insightData = {
      personalityTraits: [
        {
          trait: lowercaseNotes.includes('help') || lowercaseNotes.includes('volunteer') ? 
            "Helpful" : "Thoughtful",
          description: `${memberName} demonstrates a natural inclination to assist others and contribute to community efforts.`,
          confidence: 85
        },
        {
          trait: lowercaseNotes.includes('consistent') || lowercaseNotes.includes('attend') ? 
            "Consistent" : "Reliable",
          description: "Shows dependability and commitment to responsibilities and obligations.",
          confidence: 78
        },
        {
          trait: lowercaseNotes.includes('lead') || lowercaseNotes.includes('organiz') ? 
            "Initiative-taking" : "Supportive",
          description: lowercaseNotes.includes('lead') ? 
            "Demonstrates ability to take charge and guide others when needed." : 
            "Provides valuable support to others and strengthens team efforts.",
          confidence: 75
        },
        {
          trait: lowercaseNotes.includes('detail') || lowercaseNotes.includes('thorough') ? 
            "Detail-oriented" : "Big-picture thinker",
          description: lowercaseNotes.includes('detail') ? 
            "Pays close attention to details and ensures thoroughness in tasks." : 
            "Tends to focus on the broader vision and overall objectives.",
          confidence: 68
        }
      ],
      leadershipStyle: {
        primary: lowercaseNotes.includes('lead') || lowercaseNotes.includes('guide') ? 
          "Servant Leader" : "Supportive Contributor",
        description: lowercaseNotes.includes('lead') ? 
          "Leads by example and focuses on the growth and well-being of team members." : 
          "Contributes effectively within teams and provides valuable support to leadership.",
        potential: lowercaseNotes.includes('lead') || lowercaseNotes.includes('guide') || 
                  lowercaseNotes.includes('organiz') ? 85 : 70
      },
      loveLanguages: [
        {
          language: lowercaseNotes.includes('appreciate') || lowercaseNotes.includes('thank') || 
                    lowercaseNotes.includes('praise') ? 
            "Words of Affirmation" : lowercaseNotes.includes('time') || lowercaseNotes.includes('meet') ? 
            "Quality Time" : "Acts of Service",
          description: "Responds well to verbal appreciation and encouragement.",
          confidence: 82
        },
        {
          language: lowercaseNotes.includes('help') || lowercaseNotes.includes('assist') ? 
            "Acts of Service" : lowercaseNotes.includes('gift') || lowercaseNotes.includes('present') ? 
            "Receiving Gifts" : "Quality Time",
          description: "Values practical help and assistance as expressions of care.",
          confidence: 75
        }
      ],
      spiritualGifts: [
        {
          gift: lowercaseNotes.includes('teach') || lowercaseNotes.includes('explain') ? 
            "Teaching" : lowercaseNotes.includes('help') || lowercaseNotes.includes('serve') ? 
            "Service" : "Encouragement",
          description: lowercaseNotes.includes('teach') ? 
            "Shows ability to explain concepts clearly and help others understand spiritual truths." : 
            "Demonstrates a heart for serving others and meeting practical needs.",
          confidence: 80
        },
        {
          gift: lowercaseNotes.includes('compassion') || lowercaseNotes.includes('care') ? 
            "Mercy" : lowercaseNotes.includes('give') || lowercaseNotes.includes('donat') ? 
            "Giving" : "Administration",
          description: lowercaseNotes.includes('compassion') ? 
            "Shows deep empathy and compassion for those who are suffering." : 
            "Demonstrates organizational skills and ability to manage resources effectively.",
          confidence: 72
        }
      ],
      purposeDrivenCategory: determinePurposeDrivenCategory(lowercaseNotes),
      fiveFoldMinistry: determineFiveFoldMinistry(lowercaseNotes),
      commitmentCircle: determineCommitmentCircle(lowercaseNotes),
      engagementSuggestions: [
        {
          suggestion: lowercaseNotes.includes('small group') || lowercaseNotes.includes('community') ? 
            "Invite to lead a small group" : "Involve in community outreach activities",
          reason: "Aligns with their relational strengths and community orientation."
        },
        {
          suggestion: lowercaseNotes.includes('teach') || lowercaseNotes.includes('kid') ? 
            "Consider for children's ministry role" : "Invite to serve on welcome team",
          reason: lowercaseNotes.includes('teach') ? 
            "Their teaching gift and patience would be valuable in children's ministry." : 
            "Their warm personality would make visitors feel welcome."
        },
        {
          suggestion: "Schedule quarterly personal check-in meetings",
          reason: "To maintain connection and provide personalized spiritual guidance."
        }
      ],
      summary: `${memberName} appears to be a ${
        lowercaseNotes.includes('help') ? 'helpful' : 'committed'
      } member with ${
        lowercaseNotes.includes('lead') ? 'leadership potential' : 'strong supportive qualities'
      }. They would likely respond well to ${
        lowercaseNotes.includes('appreciate') ? 'words of affirmation' : 'quality time and acts of service'
      }. Engaging them in ${
        lowercaseNotes.includes('teach') ? 'teaching or mentoring roles' : 
        lowercaseNotes.includes('help') ? 'service-oriented ministries' : 'community-building activities'
      } would leverage their natural strengths.`
    };
    
    return insightData;
  };

  const determinePurposeDrivenCategory = (notesText) => {
    // Rick Warren's Purpose Driven Church model has 5 purposes:
    // Worship, Fellowship, Discipleship, Ministry, and Evangelism

    const keywords = {
      worship: ['worship', 'praise', 'music', 'devotion', 'pray', 'prayer', 'spiritual', 'intimate with god'],
      fellowship: ['fellowship', 'community', 'connect', 'relationship', 'friend', 'social', 'small group', 'belong'],
      discipleship: ['discipleship', 'grow', 'learn', 'study', 'bible', 'mature', 'class', 'teaching', 'knowledge'],
      ministry: ['ministry', 'serve', 'gift', 'volunteer', 'help', 'assist', 'service', 'support', 'team'],
      evangelism: ['evangelism', 'outreach', 'mission', 'share faith', 'witness', 'invite', 'reach', 'unchurched']
    };

    // Count occurrences of keywords for each category
    const scores = {};
    Object.keys(keywords).forEach(category => {
      scores[category] = keywords[category].filter(word => notesText.includes(word)).length;
    });

    // Find the top two categories
    const sortedCategories = Object.keys(scores).sort((a, b) => scores[b] - scores[a]);
    
    // If very little data, default to fellowship
    if (sortedCategories.length === 0 || (scores[sortedCategories[0]] === 0)) {
      return [{
        category: "Fellowship",
        description: "Based on limited data, the member might be best engaged through relationship-building activities. Every member needs to belong before they can grow.",
        confidence: 45,
        scriptureReference: "Acts 2:42-47",
        ministryRecommendations: ["Small Groups", "Fellowship Events", "Community Gatherings"]
      }];
    }

    // Return data for top categories
    return sortedCategories.slice(0, 2).map(category => {
      const categoryMapping = {
        worship: {
          name: "Worship",
          description: "The member appears to highly value worship and spiritual intimacy with God. They likely prioritize magnifying God through praise and prayer.",
          scriptureReference: "Psalm 29:2",
          ministryRecommendations: ["Worship Team", "Prayer Ministry", "Devotional Leadership"]
        },
        fellowship: {
          name: "Fellowship",
          description: "The member's notes suggest they thrive in community and value relationships within the church body. They prioritize belonging and connecting with others.",
          scriptureReference: "Hebrews 10:24-25",
          ministryRecommendations: ["Small Group Leadership", "Hospitality Team", "Community Events Coordinator"]
        },
        discipleship: {
          name: "Discipleship",
          description: "The member shows strong interest in spiritual growth, bible study, and developing deeper biblical knowledge. They value learning and maturing in faith.",
          scriptureReference: "2 Timothy 2:15",
          ministryRecommendations: ["Bible Study Teaching", "Mentoring Program", "Discipleship Classes"]
        },
        ministry: {
          name: "Ministry",
          description: "The member demonstrates a heart for service and using their gifts to help others. They find fulfillment in meeting practical needs within the church.",
          scriptureReference: "1 Peter 4:10",
          ministryRecommendations: ["Service Teams", "Volunteer Coordination", "Mercy Ministries"]
        },
        evangelism: {
          name: "Evangelism",
          description: "The member shows passion for outreach and sharing faith with others. They are motivated by reaching those outside the church community.",
          scriptureReference: "Mark 16:15",
          ministryRecommendations: ["Outreach Team", "Missions Committee", "Welcome/First Impressions Team"]
        }
      };

      return {
        category: categoryMapping[category].name,
        description: categoryMapping[category].description,
        confidence: 60 + (scores[category] * 10), // Adjust confidence based on keyword matches
        scriptureReference: categoryMapping[category].scriptureReference,
        ministryRecommendations: categoryMapping[category].ministryRecommendations
      };
    });
  };

  const determineFiveFoldMinistry = (notesText) => {
    // Based on Ephesians 4:11-12 - the 5-fold ministry gifts
    const keywords = {
      apostle: ['apostle', 'vision', 'pioneer', 'found', 'start', 'establish', 'strategy', 'leadership', 'multiply', 'build'],
      prophet: ['prophet', 'speak truth', 'discern', 'insight', 'revelation', 'direction', 'guidance', 'correction', 'vision', 'hear god'],
      evangelist: ['evangelist', 'outreach', 'share faith', 'gospel', 'witness', 'reach', 'invite', 'passion for lost', 'salvation'],
      pastor: ['pastor', 'shepherd', 'care', 'counsel', 'nurture', 'protect', 'guide', 'compassion', 'comfort', 'relationship'],
      teacher: ['teacher', 'teach', 'explain', 'study', 'understand', 'knowledge', 'clarity', 'doctrine', 'principle', 'learn']
    };

    // Count occurrences of keywords for each category
    const scores = {};
    Object.keys(keywords).forEach(gift => {
      scores[gift] = keywords[gift].filter(word => notesText.includes(word)).length;
    });

    // Find the top gift
    const sortedGifts = Object.keys(scores).sort((a, b) => scores[b] - scores[a]);
    
    // If very little data, return null result
    if (sortedGifts.length === 0 || (scores[sortedGifts[0]] === 0)) {
      return {
        primaryGift: "Undetermined",
        description: "Insufficient data to determine five-fold ministry gifting. More observation and interaction needed.",
        confidence: 30,
        scriptureReference: "Ephesians 4:11-12",
        explanation: "Each believer may have tendencies toward one or more of the five-fold ministry gifts (Apostle, Prophet, Evangelist, Pastor, Teacher)."
      };
    }

    // Map the top gift to its full description
    const topGift = sortedGifts[0];
    const giftMapping = {
      apostle: {
        name: "Apostolic",
        description: "Shows characteristics of an apostolic gifting with abilities to envision, pioneer and establish new works. May excel in strategic leadership.",
        confidence: 60 + (scores[topGift] * 10),
        scriptureReference: "1 Corinthians 12:28",
        explanation: "Apostolic people are visionaries who start new initiatives, establish structures, and pioneer new territory. They think strategically and see the big picture."
      },
      prophet: {
        name: "Prophetic",
        description: "Demonstrates prophetic tendencies with ability to discern spiritual realities and provide insight. May have strong intuitive understanding of situations.",
        confidence: 60 + (scores[topGift] * 10),
        scriptureReference: "Romans 12:6",
        explanation: "Prophetic people see below the surface, provide spiritual insight, and often have a strong sense of God's perspective on situations. They bring clarity and direction."
      },
      evangelist: {
        name: "Evangelistic",
        description: "Shows evangelistic traits with a passion for sharing faith and reaching those outside the church. Natural ability to communicate the gospel effectively.",
        confidence: 60 + (scores[topGift] * 10),
        scriptureReference: "Acts 21:8",
        explanation: "Evangelistic people have a heart for those who don't know Christ, excel at sharing faith naturally, and motivate others toward outreach."
      },
      pastor: {
        name: "Pastoral",
        description: "Demonstrates pastoral qualities with a heart to care for and develop others. Shows compassion and ability to shepherd people through life challenges.",
        confidence: 60 + (scores[topGift] * 10),
        scriptureReference: "1 Peter 5:2-3",
        explanation: "Pastoral people naturally care for others, counsel effectively, and help others grow. They build deep relationships and create healthy community."
      },
      teacher: {
        name: "Teaching",
        description: "Shows teaching gifts with ability to explain concepts clearly and help others understand truth. May be systematic and thorough in approach to scripture.",
        confidence: 60 + (scores[topGift] * 10),
        scriptureReference: "James 3:1",
        explanation: "Teachers help others understand truth clearly. They enjoy studying, explaining complex concepts, and helping people apply knowledge to their lives."
      }
    };

    return giftMapping[topGift];
  };

  const determineCommitmentCircle = (notesText) => {
    // Rick Warren's 5 Circles of Commitment (from outer to inner):
    // 1. Community - Unchurched/Visitors (Least committed)
    // 2. Crowd - Regular attenders
    // 3. Congregation - Members
    // 4. Committed - Maturing members
    // 5. Core - Lay ministers (Most committed)
    
    const keywords = {
      community: ['first visit', 'visitor', 'new', 'recent', 'unchurched', 'invite', 'guest', 'brought friend', 'seekers'],
      crowd: ['attend', 'service', 'sunday', 'regular', 'occasional', 'sometimes', 'worship service', 'holiday'],
      congregation: ['member', 'baptism', 'baptized', 'joined', 'membership', 'belong', 'commitment', 'class 101'],
      committed: ['growing', 'small group', 'tithe', 'giving', 'bible study', 'discipleship', 'maturing', 'class 201', 'study'],
      core: ['serve', 'ministry', 'team', 'leader', 'volunteer', 'mission', 'teach', 'faithful', 'class 301', 'mentor']
    };

    // Add commitment duration keywords that indicate deeper commitment
    const durationKeywords = ['years', 'months', 'long-time', 'long time', 'dedicated', 'committed', 'faithful', 'consistent'];
    
    // Add leadership keywords that suggest core commitment
    const leadershipKeywords = ['lead', 'coordinator', 'organiz', 'director', 'deacon', 'elder', 'board', 'committee', 'class 401'];

    // Create a scoring system for the circles
    const baseScores = {
      community: 1,
      crowd: 2,
      congregation: 3,
      committed: 4,
      core: 5
    };
    
    // Count occurrences of keywords for each circle
    const matches = {};
    Object.keys(keywords).forEach(circle => {
      matches[circle] = keywords[circle].filter(word => notesText.includes(word)).length;
    });
    
    // Count duration and leadership keywords
    const durationMatches = durationKeywords.filter(word => notesText.includes(word)).length;
    const leadershipMatches = leadershipKeywords.filter(word => notesText.includes(word)).length;
    
    // Calculate weighted scores
    let scores = {};
    Object.keys(baseScores).forEach(circle => {
      scores[circle] = matches[circle] * baseScores[circle];
      
      // If this is a more committed circle, add duration and leadership bonuses
      if (circle === 'committed' || circle === 'core') {
        scores[circle] += durationMatches * 2;
      }
      
      if (circle === 'core') {
        scores[circle] += leadershipMatches * 3;
      }
    });
    
    // Determine the highest scoring circle
    let highestCircle = 'congregation'; // Default to congregation
    let highestScore = 0;
    
    Object.keys(scores).forEach(circle => {
      if (scores[circle] > highestScore) {
        highestScore = scores[circle];
        highestCircle = circle;
      }
    });
    
    // If very little data or low scores, default to crowd
    if (highestScore < 3) {
      highestCircle = 'crowd';
    }
    
    // Map to descriptions
    const circleDescriptions = {
      community: {
        name: "Community",
        description: "This member appears to be in the Community circle - someone who is newer to the church or may be exploring faith. Focus on making them feel welcome and helping them connect with church services and events.",
        scriptureReference: "Luke 15:1-7",
        nextSteps: ["Personal invitation to Sunday services", "Connect with a greeter/welcome team member", "Invitation to newcomers' event"]
      },
      crowd: {
        name: "Crowd",
        description: "This member fits in the Crowd circle - someone who attends services regularly but may not yet have formal membership or deep involvement. Focus on helping them understand the benefits of membership and belonging.",
        scriptureReference: "Acts 2:41",
        nextSteps: ["Membership class (Class 101)", "Personal follow-up from a pastor", "Introduction to church community events"]
      },
      congregation: {
        name: "Congregation",
        description: "This member appears to be in the Congregation circle - someone who has made a membership commitment to the church. Focus on helping them grow spiritually and connect to a small group.",
        scriptureReference: "Ephesians 2:19",
        nextSteps: ["Spiritual growth class (Class 201)", "Small group connection", "Regular Bible study participation"]
      },
      committed: {
        name: "Committed",
        description: "This member fits in the Committed circle - someone actively growing in their faith journey through discipleship opportunities. Focus on helping them discover and use their spiritual gifts.",
        scriptureReference: "Romans 12:2",
        nextSteps: ["Ministry discovery process (Class 301)", "Spiritual gifts assessment", "Service opportunity exploration"]
      },
      core: {
        name: "Core",
        description: "This member appears to be in the Core circle - someone deeply committed and serving in ministry. Focus on developing their leadership and helping them mentor others.",
        scriptureReference: "Ephesians 4:11-12",
        nextSteps: ["Leadership development (Class 401)", "Ministry team leadership", "Mentoring and discipling others"]
      }
    };

    return {
      circle: circleDescriptions[highestCircle].name,
      description: circleDescriptions[highestCircle].description,
      scriptureReference: circleDescriptions[highestCircle].scriptureReference,
      nextSteps: circleDescriptions[highestCircle].nextSteps,
      allScores: scores
    };
  };

  const generatePlaceholderInsights = () => {
    return {
      personalityTraits: [
        {
          trait: "Insufficient data",
          description: "Not enough notes available to determine personality traits.",
          confidence: 0
        }
      ],
      leadershipStyle: {
        primary: "Insufficient data",
        description: "More interaction needed to determine leadership style.",
        potential: 0
      },
      loveLanguages: [
        {
          language: "Insufficient data",
          description: "Additional observations needed to determine love languages.",
          confidence: 0
        }
      ],
      spiritualGifts: [
        {
          gift: "Insufficient data",
          description: "More ministry involvement needed to identify spiritual gifts.",
          confidence: 0
        }
      ],
      purposeDrivenCategory: [
        {
          category: "Insufficient data",
          description: "More information needed to identify primary purpose area.",
          confidence: 0,
          scriptureReference: "Ephesians 4:11-16",
          ministryRecommendations: ["Begin with a spiritual gifts assessment", "Try serving in different ministry areas"]
        }
      ],
      fiveFoldMinistry: {
        primaryGift: "Undetermined",
        description: "Insufficient data to determine five-fold ministry gifting.",
        confidence: 0,
        scriptureReference: "Ephesians 4:11-12",
        explanation: "More observation needed to identify tendencies."
      },
      commitmentCircle: {
        circle: "Undetermined",
        description: "Insufficient data to determine commitment circle.",
        scriptureReference: "Ephesians 4:11-12",
        nextSteps: ["Gather more information about their involvement", "Encourage participation in church activities"]
      },
      engagementSuggestions: [
        {
          suggestion: "Schedule a personal conversation",
          reason: "To learn more about their interests, gifts, and preferred ways to serve."
        },
        {
          suggestion: "Invite to community activities",
          reason: "To observe how they interact and what energizes them."
        }
      ],
      summary: "Insufficient data available to generate meaningful insights. Consider adding more detailed notes about this member's involvement, interests, and observed behaviors."
    };
  };

  const renderConfidenceBar = (confidence) => (
    <div className="confidence-bar-container">
      <div 
        className="confidence-bar-fill" 
        style={{ width: `${confidence}%`, backgroundColor: getConfidenceColor(confidence) }}
      ></div>
      <span className="confidence-label">{confidence}% confidence</span>
    </div>
  );

  const getConfidenceColor = (confidence) => {
    if (confidence >= 80) return '#10B981'; // Green
    if (confidence >= 60) return '#3B82F6'; // Blue
    if (confidence >= 40) return '#F59E0B'; // Amber
    return '#EF4444'; // Red
  };

  if (isLoading) {
    return (
      <div className="insights-loading">
        <div className="insights-loading-spinner"></div>
        <p>Analyzing member data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="insights-error">
        <p>{error}</p>
        <button onClick={generateInsights} className="retry-button">Retry Analysis</button>
      </div>
    );
  }

  if (!insights) {
    return (
      <div className="insights-placeholder">
        <p>No member notes available for analysis.</p>
        <p>Add detailed notes about this member to generate AI-powered insights.</p>
      </div>
    );
  }

  return (
    <div className="member-insights-container">
      <div className="insights-header">
        <h3><FaLightbulb /> AI-Generated Member Insights</h3>
        <p className="insights-disclaimer">
          Based on analysis of member notes and interactions
        </p>
      </div>

      <div className="insights-summary">
        <p>{insights.summary}</p>
      </div>

      <div className="insights-grid">
        <div className="insight-card personality">
          <div className="insight-card-header">
            <h4><FaUserCheck /> Personality Traits</h4>
          </div>
          <div className="insight-card-body">
            {insights.personalityTraits.slice(0, showFullReport ? undefined : 3).map((trait, index) => (
              <div key={index} className="insight-item">
                <div className="insight-item-header">
                  <span className="trait-name">{trait.trait}</span>
                </div>
                <p className="trait-description">{trait.description}</p>
                {trait.confidence > 0 && renderConfidenceBar(trait.confidence)}
              </div>
            ))}
          </div>
        </div>

        <div className="insight-card leadership">
          <div className="insight-card-header">
            <h4><FaCrown /> Leadership Style</h4>
          </div>
          <div className="insight-card-body">
            <div className="insight-item">
              <div className="insight-item-header">
                <span className="trait-name">{insights.leadershipStyle.primary}</span>
              </div>
              <p className="trait-description">{insights.leadershipStyle.description}</p>
              {insights.leadershipStyle.potential > 0 && (
                <div className="leadership-potential">
                  <span>Leadership Potential</span>
                  {renderConfidenceBar(insights.leadershipStyle.potential)}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="insight-card love-languages">
          <div className="insight-card-header">
            <h4><FaHeart /> Love Languages</h4>
          </div>
          <div className="insight-card-body">
            {insights.loveLanguages.map((language, index) => (
              <div key={index} className="insight-item">
                <div className="insight-item-header">
                  <span className="trait-name">{language.language}</span>
                </div>
                <p className="trait-description">{language.description}</p>
                {language.confidence > 0 && renderConfidenceBar(language.confidence)}
              </div>
            ))}
          </div>
        </div>

        <div className="insight-card spiritual-gifts">
          <div className="insight-card-header">
            <h4><FaCrown /> Spiritual Gifts</h4>
          </div>
          <div className="insight-card-body">
            {insights.spiritualGifts.slice(0, showFullReport ? undefined : 2).map((gift, index) => (
              <div key={index} className="insight-item">
                <div className="insight-item-header">
                  <span className="trait-name">{gift.gift}</span>
                </div>
                <p className="trait-description">{gift.description}</p>
                {gift.confidence > 0 && renderConfidenceBar(gift.confidence)}
              </div>
            ))}
          </div>
        </div>

        <div className="insight-card purpose-driven">
          <div className="insight-card-header">
            <h4><FaCrown /> Purpose Driven Model</h4>
          </div>
          <div className="insight-card-body">
            {insights.purposeDrivenCategory.map((category, index) => (
              <div key={index} className="insight-item">
                <div className="insight-item-header">
                  <span className="trait-name">{category.category}</span>
                  <span className="scripture-badge" title={category.scriptureReference}>
                    {category.scriptureReference}
                  </span>
                </div>
                <p className="trait-description">{category.description}</p>
                {category.confidence > 0 && renderConfidenceBar(category.confidence)}
                <div className="ministry-recommendations">
                  <h5>Recommended Ministries:</h5>
                  <ul>
                    {category.ministryRecommendations.map((recommendation, idx) => (
                      <li key={idx}>{recommendation}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="insight-card five-fold-ministry">
          <div className="insight-card-header">
            <h4><FaCrown /> Five-Fold Ministry Gift</h4>
          </div>
          <div className="insight-card-body">
            <div className="insight-item">
              <div className="insight-item-header">
                <span className="trait-name">{insights.fiveFoldMinistry.primaryGift}</span>
                <span className="scripture-badge" title={insights.fiveFoldMinistry.scriptureReference}>
                  {insights.fiveFoldMinistry.scriptureReference}
                </span>
              </div>
              <p className="trait-description">{insights.fiveFoldMinistry.description}</p>
              <p className="explanation">{insights.fiveFoldMinistry.explanation}</p>
              {insights.fiveFoldMinistry.confidence > 0 && renderConfidenceBar(insights.fiveFoldMinistry.confidence)}
            </div>
          </div>
        </div>

        <div className="insight-card commitment-circle full-width">
          <div className="insight-card-header">
            <h4><FaChartPie /> Rick Warren's 5 Circles of Commitment</h4>
          </div>
          <div className="insight-card-body">
            <div className="circles-visualization">
              <div className="circles-container">
                <div className="circle community">
                  <span>Community</span>
                </div>
                <div className="circle crowd">
                  <span>Crowd</span>
                </div>
                <div className="circle congregation">
                  <span>Congregation</span>
                </div>
                <div className="circle committed">
                  <span>Committed</span>
                </div>
                <div className="circle core">
                  <span>Core</span>
                </div>
                <div className={`member-marker ${insights.commitmentCircle.circle.toLowerCase()}`}>
                  <FaUser />
                </div>
              </div>
              <div className="circle-legend">
                <div className="legend-title">Member's Position: <strong>{insights.commitmentCircle.circle}</strong></div>
                <div className="legend-scale">
                  <div className="scale-marker community">Community</div>
                  <div className="scale-marker crowd">Crowd</div>
                  <div className="scale-marker congregation">Congregation</div>
                  <div className="scale-marker committed">Committed</div>
                  <div className="scale-marker core">Core</div>
                </div>
                <div className="legend-detail">
                  <p>{insights.commitmentCircle.description}</p>
                  <div className="circle-metrics">
                    <h5>Commitment Metrics</h5>
                    <div className="metrics-grid">
                      <div className="metric-item">
                        <div className="metric-label">Community</div>
                        <div className="metric-bar-container">
                          <div className="metric-bar" style={{ width: `${Math.min(100, insights.commitmentCircle.allScores.community * 10)}%` }}></div>
                        </div>
                      </div>
                      <div className="metric-item">
                        <div className="metric-label">Crowd</div>
                        <div className="metric-bar-container">
                          <div className="metric-bar" style={{ width: `${Math.min(100, insights.commitmentCircle.allScores.crowd * 10)}%` }}></div>
                        </div>
                      </div>
                      <div className="metric-item">
                        <div className="metric-label">Congregation</div>
                        <div className="metric-bar-container">
                          <div className="metric-bar" style={{ width: `${Math.min(100, insights.commitmentCircle.allScores.congregation * 10)}%` }}></div>
                        </div>
                      </div>
                      <div className="metric-item">
                        <div className="metric-label">Committed</div>
                        <div className="metric-bar-container">
                          <div className="metric-bar" style={{ width: `${Math.min(100, insights.commitmentCircle.allScores.committed * 10)}%` }}></div>
                        </div>
                      </div>
                      <div className="metric-item">
                        <div className="metric-label">Core</div>
                        <div className="metric-bar-container">
                          <div className="metric-bar" style={{ width: `${Math.min(100, insights.commitmentCircle.allScores.core * 10)}%` }}></div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="next-steps-section">
                    <h5>Recommended Next Steps</h5>
                    <ul>
                      {insights.commitmentCircle.nextSteps.map((step, idx) => (
                        <li key={idx}>
                          <span className="step-number">{idx + 1}</span>
                          <span className="step-text">{step}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="insight-card engagement full-width">
          <div className="insight-card-header">
            <h4><FaCommentDots /> Recommended Engagement</h4>
          </div>
          <div className="insight-card-body recommendations">
            {insights.engagementSuggestions.map((suggestion, index) => (
              <div key={index} className="recommendation-item">
                <div className="recommendation-content">
                  <h5>{suggestion.suggestion}</h5>
                  <p>{suggestion.reason}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="insights-footer">
        <button onClick={() => setShowFullReport(!showFullReport)} className="toggle-report-button">
          {showFullReport ? 'Show Summary' : 'View Full Report'}
        </button>
        <button onClick={generateInsights} className="refresh-insights-button">
          Refresh Analysis
        </button>
        <p className="ai-disclaimer">
          This analysis is AI-generated based on available notes and should be considered as suggestions, not definitive assessments.
        </p>
      </div>
    </div>
  );
};

export default MemberInsightsAnalysis;