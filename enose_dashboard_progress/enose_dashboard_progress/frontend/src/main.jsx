import React, {useEffect, useState} from "react";
import {createRoot} from "react-dom/client";
import {LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer} from "recharts";
import jsPDF from "jspdf";
import "./style.css";
import * as XLSX from "xlsx-js-style";

const CONTAINER_URL = "backend-db.bravedesert-90e1dd1a.indonesiacentral.azurecontainerapps.io";
const API = import.meta.env.VITE_API_URL || `https://${CONTAINER_URL}`;
const WS_URL = import.meta.env.VITE_WS_URL || `wss://${CONTAINER_URL}/ws`;

function App() {
  const [type, setType] = useState("robusta");
  const [status, setStatus] = useState("Green Bean");
  const [batch, setBatch] = useState("1");
  const [data, setData] = useState([]);
  const [stats, setStats] = useState(null);
  const [backendStatus, setBackendStatus] = useState("Checking...");
  const [dbStatus, setDbStatus] = useState("Checking...");
  const [isOnline, setIsOnline] = useState(false);
  const [fwVersion, setFwVersion] = useState("v1.0");
  
  // State untuk Modal Upload Firmware OTA
  const [showModal, setShowModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatusMsg, setUploadStatusMsg] = useState("");

  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 50;

  async function checkHealth() {
    try {
      const res = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const json = await res.json();
        setBackendStatus("Online");
        setDbStatus(json.db ?? "Connected");
        setIsOnline(true);
      } else {
        setBackendStatus("Error");
        setDbStatus("Disconnected");
        setIsOnline(false);
      }
    } catch (err) {
      setBackendStatus("Offline");
      setDbStatus("Disconnected");
      setIsOnline(false);
    }
  }

  async function load() {
    try {
      const batchQuery = batch === "all" ? "" : `&batch=${batch}`;
      const rows = await fetch(`${API}/api/sampling?coffee_type=${type}&bean_status=${status}${batchQuery}`).then(r=>r.json());
      const reversedRows = rows.reverse();
      setData(reversedRows);
      
      if (reversedRows.length > 0) {
        const latest = reversedRows[reversedRows.length - 1];
        const currentFw = latest.data?.firmware_version || latest.firmware_version;
        if (currentFw) setFwVersion(currentFw);
      }

      const s = await fetch(`${API}/api/statistics?coffee_type=${type}&bean_status=${status}${batchQuery}`).then(r=>r.json());
      setStats(s);
    } catch (err) {
      console.error("Gagal memuat data:", err);
    }
  }

  useEffect(() => { 
    checkHealth();
    load(); 
    const healthInterval = setInterval(checkHealth, 10000);
    return () => clearInterval(healthInterval);
  }, [type, status, batch]);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    ws.onmessage = e => {
      const item = JSON.parse(e.data);
      const incomingType = item.coffee_type || item.data?.coffee_type;
      const incomingStatus = item.bean_status || item.data?.bean_status;
      const incomingBatch = item.batch || item.data?.batch;
      
      const incomingFw = item.data?.firmware_version || item.firmware_version;
      if (incomingFw) {
         setFwVersion(incomingFw);
      }

      const isTypeMatch = incomingType === type;
      const isStatusMatch = !incomingStatus || incomingStatus === status;
      const isBatchMatch = batch === "all" || !incomingBatch || String(incomingBatch) === String(batch);

      if (isTypeMatch && isStatusMatch && isBatchMatch) {
        const limit = batch === "all" ? -2000 : -100;
        setData(prev => [...prev, item].slice(limit));
      }
    };
    ws.onerror = () => setIsOnline(false);
    ws.onopen = () => setIsOnline(true);
    return () => ws.close();
  }, [type, status, batch]);

  const handleTypeChange = (e) => {
    setType(e.target.value);
    setCurrentPage(1);
  };

  const handleStatusChange = (e) => {
    setStatus(e.target.value);
    setCurrentPage(1);
  };

  const handleBatchChange = (e) => {
    setBatch(e.target.value);
    setCurrentPage(1);
  };

  // Handler Upload File Firmware .bin
  async function handleFirmwareUpload(e) {
    e.preventDefault();
    if (!selectedFile) {
      alert("Pilih file .bin terlebih dahulu!");
      return;
    }

    if (!selectedFile.name.endsWith(".bin")) {
      alert("File harus berformat .bin!");
      return;
    }

    setIsUploading(true);
    setUploadStatusMsg("Mengunggah firmware ke Azure Storage...");

    const formData = new FormData();
    formData.append("firmware", selectedFile);

    try {
      const res = await fetch(`${API}/api/firmware`, {
        method: "POST",
        body: formData,
      });

      const result = await res.json();
      if (res.ok) {
        setUploadStatusMsg("✅ Upload sukses! Pemicu OTA terkirim ke ESP32-S3.");
        setTimeout(() => {
          setShowModal(false);
          setSelectedFile(null);
          setUploadStatusMsg("");
        }, 2000);
      } else {
        setUploadStatusMsg(`❌ Error: ${result.message || "Gagal mengunggah"}`);
      }
    } catch (err) {
      setUploadStatusMsg(`❌ Gagal terhubung ke server: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  }

  const getActualExportData = () => {
    return data.map((item, index) => {
      const confScore = item.data?.confidence_score ?? item.confidence_score ?? item.data?.sensors?.confidence_score;
      const isAccurate = confScore !== undefined && confScore >= 90;
      const s = item.data?.sensors ?? item.sensors ?? item.data ?? {};
      
      return {
        No: index + 1,
        Time: new Date(item.timestamp).toLocaleTimeString("id-ID"),
        Temp: s.temperature ?? 0,
        Hum: s.humidity ?? 0,
        MQ3: s.mq3 ?? 0,
        MQ6: s.mq6 ?? 0,
        MQ7: s.mq7 ?? 0,
        MQ135: s.mq135 ?? 0,
        TGS2600: s.tgs2600 ?? 0,
        TGS2602: s.tgs2602 ?? 0,
        TGS2611: s.tgs2611 ?? 0,
        TGS2620: s.tgs2620 ?? 0,
        Classification: item.data?.coffee_type || item.coffee_type || "Unknown",
        Status: item.data?.bean_status || item.bean_status || status,
        Batch: item.data?.batch || item.batch || (batch === "all" ? "Mixed" : batch),
        "Confidence Score": confScore !== undefined ? `${confScore}%` : "Not trained",
        "Accuration Status": confScore !== undefined ? (isAccurate ? "Accurate" : "Not Accurate") : "Not yet trained in edge impulse"
      };
    });
  };

  function exportPDF() {
    const pdf = new jsPDF();
    const currentDate = new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" });
    const currentTime = new Date().toLocaleTimeString("id-ID");

    pdf.setFontSize(14);
    pdf.setFont("helvetica", "bold");
    pdf.text("E-NOSE ML VALIDATION REPORT", 105, 15, { align: "center" });

    pdf.setDrawColor(150, 150, 150);
    pdf.setLineWidth(0.5);
    pdf.line(14, 19, 196, 19);

    pdf.setFontSize(10);
    pdf.setFont("helvetica", "normal");
    pdf.text("Device Used: esp32s3-device-01", 14, 26);
    pdf.text(`Tanggal Pengujian: ${currentDate} ${currentTime}`, 14, 32);
    
    const batchLabel = batch === "all" ? "Total Batch" : `Batch ${batch}`;
    pdf.text(`Sample Setup: ${type.toUpperCase()} | ${status} | ${batchLabel}`, 14, 38);

    const actualSamples = getActualExportData();

    let validCount = 0;
    let accurateCount = 0;
    actualSamples.forEach(item => {
      if (item["Confidence Score"] !== "Not trained") {
        validCount++;
        if (item["Accuration Status"] === "Accurate") accurateCount++;
      }
    });

    const notAccurateCount = validCount - accurateCount;
    const totalAccuracyPercent = validCount > 0 ? ((accurateCount / validCount) * 100).toFixed(1) + "%" : "N/A";

    let summaryY = 44;
    pdf.setFillColor(245, 247, 250);
    pdf.rect(14, summaryY, 182, 18, "F");
    pdf.setDrawColor(210, 215, 220);
    pdf.rect(14, summaryY, 182, 18, "S");

    pdf.setFontSize(9);
    pdf.setFont("helvetica", "bold");
    pdf.text("Total Sample", 22, summaryY + 6);
    pdf.text("Trained Data", 62, summaryY + 6);
    pdf.text("Accurate (>=90%)", 107, summaryY + 6);
    pdf.text("Not Accurate", 145, summaryY + 6);
    pdf.text("Total Accuracy", 175, summaryY + 6);

    pdf.setFont("helvetica", "normal");
    pdf.text(actualSamples.length.toString(), 25, summaryY + 13);
    pdf.text(validCount.toString(), 65, summaryY + 13);
    pdf.text(accurateCount.toString(), 115, summaryY + 13);
    pdf.text(notAccurateCount.toString(), 152, summaryY + 13);
    pdf.text(totalAccuracyPercent, 180, summaryY + 13);

    let startY = 70;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.text("Detailed Classification & Confidence Results", 14, startY);

    startY += 5;
    pdf.setFontSize(9);
    pdf.setFillColor(211, 84, 0);
    pdf.setTextColor(255, 255, 255);
    pdf.rect(14, startY, 182, 7, "F");
    pdf.text("No", 17, startY + 5);
    pdf.text("Time", 30, startY + 5);
    pdf.text("Class", 55, startY + 5);
    pdf.text("Status", 80, startY + 5);
    pdf.text("Confidence", 110, startY + 5);
    pdf.text("Accuration Status", 145, startY + 5);

    startY += 7;
    pdf.setTextColor(0, 0, 0);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);

    actualSamples.forEach((item, index) => {
      if (startY > 275) {
        pdf.addPage();
        startY = 20;
      }

      if (index % 2 === 0) {
        pdf.setFillColor(250, 250, 250);
        pdf.rect(14, startY, 182, 6, "F");
      }

      pdf.text(item.No.toString(), 17, startY + 4);
      pdf.text(item.Time, 30, startY + 4);
      pdf.text(item.Classification, 55, startY + 4);
      pdf.text(item.Status, 80, startY + 4);
      pdf.text(item["Confidence Score"], 110, startY + 4);
      
      if (item["Accuration Status"] === "Accurate") {
        pdf.setTextColor(39, 174, 96);
      } else if (item["Accuration Status"] === "Not Accurate") {
        pdf.setTextColor(192, 57, 43);
      } else {
        pdf.setTextColor(100, 100, 100);
      }
      pdf.text(item["Accuration Status"], 145, startY + 4);
      
      pdf.setTextColor(0, 0, 0);
      pdf.setDrawColor(230, 230, 230);
      pdf.line(14, startY + 6, 196, startY + 6);

      startY += 6;
    });

    pdf.save(`E-Nose-ML-Validation-Report.pdf`);
  }

  function exportCSV() {
    const actualSamples = getActualExportData();
    const worksheet = XLSX.utils.json_to_sheet(actualSamples);
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, worksheet, "Validation Data");

    worksheet["!cols"] = [
      { wch: 5 }, { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, 
      { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, 
      { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 18 }, { wch: 28 }
    ];
    worksheet["!rows"] = [{ hpt: 25 }];

    const headerCells = ["A1", "B1", "C1", "D1", "E1", "F1", "G1", "H1", "I1", "J1", "K1", "L1", "M1", "N1", "O1", "P1", "Q1"];
    headerCells.forEach((cell) => {
      if(worksheet[cell]) {
        worksheet[cell].s = {
          fill: { fgColor: { rgb: "D35400" } },
          font: { name: "Arial", sz: 10, bold: true, color: { rgb: "FFFFFF" } },
          alignment: { horizontal: "center", vertical: "center" },
          border: {
            top: { style: "thin", color: { rgb: "FFFFFF" } },
            bottom: { style: "thin", color: { rgb: "FFFFFF" } },
            left: { style: "thin", color: { rgb: "FFFFFF" } },
            right: { style: "thin", color: { rgb: "FFFFFF" } }
          }
        };
      }
    });

    const range = XLSX.utils.decode_range(worksheet["!ref"]);
    for (let row = range.s.r; row <= range.e.r; row++) {
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
        if (!worksheet[cellAddress]) continue;

        worksheet[cellAddress].s = {
          ...(worksheet[cellAddress].s || {}),
          border: {
            top: { style: "thin", color: { rgb: "BFBFBF" } },
            bottom: { style: "thin", color: { rgb: "BFBFBF" } },
            left: { style: "thin", color: { rgb: "BFBFBF" } },
            right: { style: "thin", color: { rgb: "BFBFBF" } }
          },
          alignment: {
            vertical: "center",
            horizontal: col === 0 ? "center" : "left"
          }
        };

        if (col === 16 && row > 0) {
          const acc_status = worksheet[cellAddress].v;
          if (acc_status === "Accurate") {
            worksheet[cellAddress].s = {
              ...worksheet[cellAddress].s,
              fill: { fgColor: { rgb: "C6EFCE" } },
              font: { bold: true, color: { rgb: "006100" } },
              alignment: { horizontal: "center", vertical: "center" }
            };
          } else if (acc_status === "Not Accurate") {
            worksheet[cellAddress].s = {
              ...worksheet[cellAddress].s,
              fill: { fgColor: { rgb: "FFC7CE" } },
              font: { bold: true, color: { rgb: "9C0006" } },
              alignment: { horizontal: "center", vertical: "center" }
            };
          } else {
             worksheet[cellAddress].s = {
              ...worksheet[cellAddress].s,
              font: { color: { rgb: "666666" } },
              alignment: { horizontal: "center", vertical: "center" }
            };
          }
        }
      }
    }

    worksheet["!autofilter"] = { ref: worksheet["!ref"] };
    worksheet["!freeze"] = { xSplit: 0, ySplit: 1 };

    XLSX.writeFile(workbook, "E-Nose-ML-Validation-Report.xlsx");
  }

  const chartData = data.map((x, i) => {
    const s = x.data?.sensors ?? x.sensors ?? x.data ?? {};
    return {
      n: i + 1, 
      MQ3: s.mq3 ?? 0, 
      MQ6: s.mq6 ?? 0,
      MQ7: s.mq7 ?? 0,
      MQ135: s.mq135 ?? 0, 
      TGS2600: s.tgs2600 ?? 0,
      TGS2602: s.tgs2602 ?? 0,
      TGS2611: s.tgs2611 ?? 0,
      TGS2620: s.tgs2620 ?? 0,
      Temp: s.temperature ?? 0,
      Hum: s.humidity ?? 0,
    };
  });

  const sensorKeys = ['MQ3', 'MQ6', 'MQ7', 'MQ135', 'TGS2600', 'TGS2602', 'TGS2611', 'TGS2620', 'Temp', 'Hum'];
  const colors = ['#e67e22', '#2980b9', '#27ae60', '#8e44ad', '#f1c40f', '#e74c3c', '#34495e', '#16a085', '#c0392b', '#3498db'];

  const latestItem = data[data.length - 1] || {};
  const latestConf = latestItem?.data?.confidence_score ?? latestItem?.confidence_score ?? latestItem?.data?.sensors?.confidence_score;
  const isTrained = latestConf !== undefined;
  
  const accuracyDisplay = isTrained 
    ? `${latestConf}%` 
    : <span style={{fontSize: '13px', lineHeight: '1.2', display: 'block', color: '#7f8c8d'}}>Not yet trained<br/>in edge impulse</span>;

  const reversedTableData = data.slice().reverse();
  const totalPages = Math.ceil(reversedTableData.length / ITEMS_PER_PAGE);
  const indexOfLastItem = currentPage * ITEMS_PER_PAGE;
  const indexOfFirstItem = indexOfLastItem - ITEMS_PER_PAGE;
  const currentTableItems = reversedTableData.slice(indexOfFirstItem, indexOfLastItem);

  return <main>
    <div className="header-container">
      <div>
        <h1>E-Nose Coffee Dashboard</h1>
        <p>ESP32-S3 → Rust Backend → Azure Cosmos DB → React</p>
      </div>
      <div style={{display: "flex", gap: "10px", alignItems: "center"}}>
        <button 
          onClick={() => setShowModal(true)}
          style={{
            background: "#8e44ad", 
            color: "white", 
            border: "none", 
            padding: "8px 14px", 
            borderRadius: "6px", 
            cursor: "pointer", 
            fontWeight: "bold",
            display: "flex",
            alignItems: "center",
            gap: "6px"
          }}
        >
          📤 Upload OTA
        </button>

        <div className="status-badge" style={{background: "#2980b9", color: "white"}}>
          <span style={{fontSize: "14px", marginRight: "4px"}}>🔄</span>
          Firmware: {fwVersion}
        </div>
        <div className="status-badge">
          <span className={`status-dot ${isOnline ? 'online' : 'offline'}`}></span>
          Backend: {backendStatus}
        </div>
        <div className="status-badge">
          <span className={`status-dot ${dbStatus === 'Connected' ? 'online' : 'offline'}`}></span>
          Cosmos DB: {dbStatus}
        </div>
      </div>
    </div>

    {/* MODAL DIALOG UPLOAD FIRMWARE */}
    {showModal && (
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)", display: "flex",
        justifyContent: "center", alignItems: "center", zIndex: 1000
      }}>
        <div style={{
          background: "white", padding: "25px", borderRadius: "10px",
          width: "400px", boxShadow: "0 4px 15px rgba(0,0,0,0.2)"
        }}>
          <h3 style={{marginTop: 0, color: "#2c3e50"}}>Upload Firmware OTA (.bin)</h3>
          <p style={{fontSize: "13px", color: "#7f8c8d"}}>
            Pilih file binary baru hasil build dari Edge Impulse / PlatformIO.
          </p>

          <form onSubmit={handleFirmwareUpload}>
            <input 
              type="file" 
              accept=".bin" 
              onChange={e => setSelectedFile(e.target.files[0])}
              style={{marginBottom: "15px", width: "100%"}}
            />

            {uploadStatusMsg && (
              <p style={{fontSize: "12px", fontWeight: "bold", color: uploadStatusMsg.startsWith("❌") ? "#c0392b" : "#27ae60"}}>
                {uploadStatusMsg}
              </p>
            )}

            <div style={{display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "20px"}}>
              <button 
                type="button" 
                onClick={() => { setShowModal(false); setUploadStatusMsg(""); }}
                disabled={isUploading}
                style={{padding: "8px 15px", background: "#bdc3c7", border: "none", borderRadius: "5px", cursor: "pointer"}}
              >
                Batal
              </button>
              <button 
                type="submit" 
                disabled={isUploading}
                style={{padding: "8px 15px", background: "#2980b9", color: "white", border: "none", borderRadius: "5px", cursor: "pointer", fontWeight: "bold"}}
              >
                {isUploading ? "Mengunggah..." : "Unggah & Trigger OTA"}
              </button>
            </div>
          </form>
        </div>
      </div>
    )}

    <div className="toolbar">
      <select value={type} onChange={handleTypeChange}>
        <option value="robusta">Robusta</option>
        <option value="arabika">Arabika</option>
        <option value="excelsa">Excelsa</option>
      </select>

      <select value={status} onChange={handleStatusChange}>
        <option value="Green Bean">Green Bean</option>
        <option value="Roasted">Roasted</option>
      </select>

      <select value={batch} onChange={handleBatchChange}>
        {[...Array(10)].map((_, i) => (
          <option key={i + 1} value={i + 1}>
            Batch {i + 1}
          </option>
        ))}
        <option value="all">Total Batch</option>
      </select>

      <button className="export-pdf" onClick={exportPDF}>
        📄 Export Validation PDF
      </button>

      <button className="export-csv" onClick={exportCSV}>
        📊 Export Sensor CSV
      </button>
    </div>

    <section className="cards">
      <Card title="Total Data" value={data.length ?? 0} icon="📦" />
      <Card title="Model Accuracy" value={accuracyDisplay} icon="🎯" />
    </section>

    <section className="panel">
      <h2>Individual Sensor Trends (8 Gas + 2 Env)</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px', marginTop: '15px' }}>
        {sensorKeys.map((sensor, idx) => (
          <div key={sensor} style={{ border: '1px solid #e0e6ed', padding: '10px', borderRadius: '8px', background: '#fafbfc' }}>
            <h4 style={{ margin: '0 0 10px 0', textAlign: 'center', color: '#2c3e50', fontSize: '13px' }}>{sensor}</h4>
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={chartData}>
                <XAxis dataKey="n" hide />
                <YAxis width={30} fontSize={10} tickFormatter={(tick) => Math.round(tick)} />
                <Tooltip contentStyle={{ fontSize: '12px', padding: '5px' }} />
                <Line type="monotone" dataKey={sensor} stroke={colors[idx]} strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>
    </section>

    <section className="panel">
      <h2>Combined Sensors Overview (Multichart)</h2>
      <ResponsiveContainer width="100%" height={350}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3"/>
          <XAxis dataKey="n"/>
          <YAxis/>
          <Tooltip/>
          <Legend/>
          {sensorKeys.map((sensor, idx) => (
             <Line key={sensor} type="monotone" dataKey={sensor} stroke={colors[idx]} strokeWidth={2} dot={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </section>

    <section className="panel">
      <h2>Sampling Data & ML Classification</h2>
      <div style={{overflowX: 'auto'}}>
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Temp</th>
              <th>RH</th>
              <th>MQ3</th>
              <th>MQ6</th>
              <th>MQ7</th>
              <th>MQ135</th>
              <th>TGS2600</th>
              <th>TGS2602</th>
              <th>TGS2611</th>
              <th>TGS2620</th>
              <th>Status Bean</th>
              <th>Batch</th>
              <th>Confidence</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {currentTableItems.map(x => {
              const sensorData = x.data?.sensors ?? x.sensors ?? x.data ?? {};
              const confScore = x.data?.confidence_score ?? x.confidence_score ?? sensorData.confidence_score;
              const isAccurate = confScore !== undefined && confScore >= 90;
              const currentStatusBean = x.data?.bean_status ?? x.bean_status ?? status;
              const currentBatchInfo = x.data?.batch ?? x.batch ?? batch;
              
              return (
                <tr key={x.id ?? Math.random()}>
                  <td>{new Date(x.timestamp).toLocaleString()}</td>
                  <td>{sensorData.temperature ?? 0}</td>
                  <td>{sensorData.humidity ?? 0}</td>
                  <td>{sensorData.mq3 ?? 0}</td>
                  <td>{sensorData.mq6 ?? 0}</td>
                  <td>{sensorData.mq7 ?? 0}</td>
                  <td>{sensorData.mq135 ?? 0}</td>
                  <td>{sensorData.tgs2600 ?? 0}</td>
                  <td>{sensorData.tgs2602 ?? 0}</td>
                  <td>{sensorData.tgs2611 ?? 0}</td>
                  <td>{sensorData.tgs2620 ?? 0}</td>
                  <td>{currentStatusBean}</td>
                  <td>{currentBatchInfo === "all" ? "Mixed" : currentBatchInfo}</td>
                  <td>{confScore !== undefined ? `${confScore}%` : "-"}</td>
                  <td>
                    {confScore !== undefined 
                      ? (isAccurate ? <strong style={{color: '#27ae60'}}>Accurate</strong> : <strong style={{color: '#c0392b'}}>Not Accurate</strong>) 
                      : <span style={{color: '#7f8c8d'}}>Not Trained</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '15px', marginTop: '20px' }}>
          <button 
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))} 
            disabled={currentPage === 1}
            style={{ padding: '6px 12px', cursor: currentPage === 1 ? 'not-allowed' : 'pointer', background: currentPage === 1 ? '#ecf0f1' : '#3498db', color: currentPage === 1 ? '#95a5a6' : 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold' }}
          >
            &laquo; Previous
          </button>
          
          <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#2c3e50' }}>
            Page {currentPage} of {totalPages}
          </span>
          
          <button 
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} 
            disabled={currentPage === totalPages}
            style={{ padding: '6px 12px', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer', background: currentPage === totalPages ? '#ecf0f1' : '#3498db', color: currentPage === totalPages ? '#95a5a6' : 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold' }}
          >
            Next &raquo;
          </button>
        </div>
      )}
    </section>
  </main>
}

function Card({title, value, icon}) { 
  return (
    <div className="card">
      <div className="card-header">
        <small>{title}</small>
        <span className="card-icon">{icon}</span>
      </div>
      <strong>{value}</strong>
    </div>
  ); 
}

createRoot(document.getElementById("root")).render(<App/>);