import { useState, useRef, useEffect } from "react";
import { getDocument, GlobalWorkerOptions, version } from "pdfjs-dist";
import { childQuestionnaireMap } from "../data/childQuestionnaireMap";
import "pdfjs-dist/legacy/build/pdf.worker.min.js";

GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${version}/pdf.worker.min.js`;

const QuestionnaireUpload = () => {
    const [fileName, setFileName] = useState(null);
    const [results, setResults] = useState(null);
    const canvasContainerRef = useRef(null);

    useEffect(() => {
        const container = canvasContainerRef.current;
        if (!container) return;

        let isDragging = false;
        let startX = 0;
        let startY = 0;

        const handleMouseDown = (event) => {
            if (event.target.tagName !== "CANVAS") return;
            const rect = event.target.getBoundingClientRect();
            startX = event.clientX - rect.left;
            startY = event.clientY - rect.top;
            isDragging = true;
        };

        const handleMouseUp = (event) => {
            if (!isDragging || event.target.tagName !== "CANVAS") return;
            const rect = event.target.getBoundingClientRect();
            const endX = event.clientX - rect.left;
            const endY = event.clientY - rect.top;
            isDragging = false;

            const x = Math.round(Math.min(startX, endX));
            const y = Math.round(Math.min(startY, endY));
            const width = Math.round(Math.abs(endX - startX));
            const height = Math.round(Math.abs(endY - startY));

            console.log(`🟥 Drawn box at (x: ${x}, y: ${y}, width: ${width}, height: ${height})`);
        };

        container.addEventListener("mousedown", handleMouseDown);
        container.addEventListener("mouseup", handleMouseUp);

        return () => {
            container.removeEventListener("mousedown", handleMouseDown);
            container.removeEventListener("mouseup", handleMouseUp);
        };
    }, []);

    const analyzePDF = async (canvases) => {
        const ctxList = canvases.map((canvas) => canvas.getContext("2d"));
        const categoryTotals = {};
        let overallTotal = 0;

        for (const question of childQuestionnaireMap) {
            const { page, boxes, category, question: qNum } = question;

            console.log(`Analyzing Question ${qNum} (category: "${category}") on page ${page}`);

            if (!ctxList[page]) {
                console.warn(`⚠️ No canvas found for page ${page} (Question ${qNum})`);
                continue;
            }

            const ctx = ctxList[page];
            let selectedIndex = -1;
            let highestRatio = 0;

            for (let i = 0; i < boxes.length; i++) {
                const { x, y, width, height } = boxes[i];
                const imageData = ctx.getImageData(x, y, width, height);

                const pixels = imageData.data;
                let darkPixels = 0;
                for (let j = 0; j < pixels.length; j += 4) {
                    const r = pixels[j];
                    const g = pixels[j + 1];
                    const b = pixels[j + 2];
                    const avg = (r + g + b) / 3;
                    if (avg < 128) darkPixels++;
                }

                const darkRatio = darkPixels / (pixels.length / 4);
                console.log(
                    `-- Checking box ${i} at (${x},${y},${width}x${height}) - dark pixel ratio: ${darkRatio.toFixed(2)}`
                );

                // Draw every box red
                ctx.strokeStyle = "red";
                ctx.lineWidth = 2;
                ctx.strokeRect(x, y, width, height);

                if (darkRatio > highestRatio) {
                    highestRatio = darkRatio;
                    selectedIndex = i;
                }
            }

            // Draw the selected (darkest) box green
            if (selectedIndex !== -1) {
                const { x, y, width, height } = boxes[selectedIndex];
                ctx.strokeStyle = "green";
                ctx.lineWidth = 2;
                ctx.strokeRect(x, y, width, height);

                console.log(
                    `✅ Question ${qNum} (category: "${category}") - Selected box index: ${selectedIndex} on page ${page} with ratio ${highestRatio.toFixed(2)}`
                );

                categoryTotals[category] = (categoryTotals[category] || 0) + selectedIndex;
                overallTotal += selectedIndex;
            } else {
                console.log(`❌ Question ${qNum} (category: "${category}") - No box selected on page ${page}`);
            }
        }

        console.log("=== Category totals ===");
        console.table(categoryTotals);
        console.log("Overall total score:", overallTotal);

        setResults({ categoryTotals, overallTotal });
    };

    const handleUpload = async (event) => {
        const file = event.target.files[0];
        if (!file || file.type !== "application/pdf") return;

        setFileName(file.name);
        const container = canvasContainerRef.current;
        container.innerHTML = "";

        const reader = new FileReader();
        reader.onload = async () => {
            const typedarray = new Uint8Array(reader.result);
            const pdf = await getDocument(typedarray).promise;

            const canvases = [];
            const scale = 1;

            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const viewport = page.getViewport({ scale });

                const canvas = document.createElement("canvas");
                const context = canvas.getContext("2d", { willReadFrequently: true });

                canvas.width = viewport.width;
                canvas.height = viewport.height;

                await page.render({ canvasContext: context, viewport }).promise;

                container.appendChild(canvas);
                canvases.push(canvas);
            }

            analyzePDF(canvases);
        };

        reader.readAsArrayBuffer(file);
    };

    return (
        <div className="pdf-section">
            <h2>Upload Child Questionnaire</h2>
            <input type="file" accept="application/pdf" onChange={handleUpload} />
            {fileName && <p className="mt-2 text-green-600 text-sm">✔️ {fileName} loaded</p>}
            <div ref={canvasContainerRef} className="canvas-wrapper" />
            {results && (
                <div className="mt-4">
                    <h3 className="text-lg font-semibold mb-2">SCORING</h3>
                    <p className="mt-0 text-l">A total score of ≥ <strong>25</strong> may indicate the presence of an <strong>Anxiety Disorder</strong>.</p>
                    <p className="mt-0 text-l">Scores higher than 30 are more specific.</p>
                    <h3 className="text-lg font-semibold mb-2">Category Totals:</h3>
                    <ul>
                        {Object.entries(results.categoryTotals).map(([category, value]) => (
                            <li key={category}>
                                <strong>{category}:</strong> {value}
                            </li>
                        ))}
                    </ul>
                    <p className="mt-2 text-xl font-bold">Total Score: {results.overallTotal}</p>
                </div>
            )}
        </div>
    );
};

export default QuestionnaireUpload;
