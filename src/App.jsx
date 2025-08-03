import { useState } from "react";
import QuestionnaireUpload from "./components/QuestionnaireUpload";
import "./styles/pdfStyles.css";

function App() {
  const [childCanvases, setChildCanvases] = useState([]);
  const [parentCanvases, setParentCanvases] = useState([]);

  const handleChildUpload = (canvases) => {
    setChildCanvases(canvases);
  };

  const handleParentUpload = (canvases) => {
    setParentCanvases(canvases);
  };

  return (
    <div className="max-w-4xl mx-auto p-8 font-sans">
      <h1 className="text-2xl font-bold mb-6 text-center">
        PDF Questionnaire Analyzer
      </h1>

      <div className="p-10 bg-green-500 text-white">
        Tailwind is working!
      </div>


      <QuestionnaireUpload
        label="Upload Child Questionnaire"
        onLoad={handleChildUpload}
      />

      <QuestionnaireUpload
        label="Upload Parent Questionnaire"
        onLoad={handleParentUpload}
      />
    </div>
  );
}

export default App;
