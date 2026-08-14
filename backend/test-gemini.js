require("dotenv").config();

const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

async function testGemini() {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: "Reply with only YES or NO. Is 2 + 2 equal to 4?",
    });

    console.log("Gemini response:");
    console.log(response.text);
  } catch (error) {
    console.error("Gemini test failed:");
    console.error(error.message);
  }
}

testGemini();