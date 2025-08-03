import { useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, version } from "pdfjs-dist";
import "pdfjs-dist/legacy/build/pdf.worker.min.js";

GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${version}/pdf.worker.min.js`;

const PDFUploader = ({ onLoad }) => {
    const [pdfName, setPdfName] = useState("");
    const containerRef = useRef(null);

    const handleFileChange = async (event) => {
        const file = event.target.files[0];
        if (!file || file.type !== "application/pdf") return;

        setPdfName(file.name);

        const reader = new FileReader();
        reader.onload = async () => {
            const typedarray = new Uint8Array(reader.result);
            const pdf = await getDocument(typedarray).promise;
            const numPages = pdf.numPages;

            // Clear container before rendering
            const container = containerRef.current;
            container.innerHTML = "";

            const canvases = [];

            for (let i = 1; i <= numPages; i++) {
                const page = await pdf.getPage(i);
                const viewport = page.getViewport({ scale: 1 });

                const canvas = document.createElement("canvas");
                canvas.width = viewport.width;
                canvas.height = viewport.height;

                const context = canvas.getContext("2d");
                await page.render({ canvasContext: context, viewport }).promise;

                container.appendChild(canvas);
                canvases.push(canvas);
            }

            // Pass the canvases back to parent for analysis
            if (onLoad) onLoad(canvases);
        };

        reader.readAsArrayBuffer(file);
    };

    return (
        <div className="p-4 border rounded max-w-xl mx-auto mb-8">
            <h2 className="text-xl font-bold mb-2">Upload Questionnaire PDF</h2>
            <input type="file" accept="application/pdf" onChange={handleFileChange} />
            {pdfName && <p className="mt-2 text-sm">Loaded: {pdfName}</p>}
            <div ref={containerRef} className="mt-4 border shadow" />
        </div>
    );
};

export default PDFUploader;
