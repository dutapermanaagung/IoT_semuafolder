const { app } = require('@azure/functions');
const { Registry } = require('azure-iothub');

// Pastikan menambahkan IotHubRegistryConnectionString di Application Settings portal Azure
const IOTHUB_CONNECTION_STRING = process.env.IotHubRegistryConnectionString;
const registry = Registry.fromConnectionString(IOTHUB_CONNECTION_STRING);

app.eventGrid('trigger-ota', {
    handler: async (event, context) => {
        context.log('Event Grid OTA Triggered:', event);

        // Hanya proses jika event adalah Blob Created (Upload File Baru)
        if (event.eventType === 'Microsoft.Storage.BlobCreated') {
            const blobUrl = event.data.url;
            
            // Validasi: Pastikan yang diupload adalah file .bin di container "firmware"
            if (!blobUrl.includes('/firmware/') || !blobUrl.endsWith('.bin')) {
                context.log('File diabaikan karena bukan firmware (.bin)');
                return;
            }

            context.log(`Firmware baru terdeteksi di Storage: ${blobUrl}`);
            const targetDevice = "esp32s3-device-01"; 
            const fileName = blobUrl.split('/').pop();
            const targetVersion = fileName.replace('.bin', ''); // Menjadi "firmware_v1.2"

            try {
                // Ambil struktur Twin dari IoT Hub saat ini
                const twin = await registry.getTwin(targetDevice);
                
                // Siapkan patch desired properties untuk mentrigger OTA di ESP32
                const twinPatch = {
                    properties: {
                        desired: {
                            firmware_url: blobUrl,
                            target_version: targetVersion,
                            update_trigger: new Date().toISOString()
                        }
                    }
                };

                // Update Twin via IoT Hub
                await registry.updateTwin(targetDevice, twinPatch, twin.responseBody.etag);
                context.log(`✅ Instruksi OTA otomatis dikirim ke Device: ${targetDevice}`);
            } catch (error) {
                context.error(`❌ Gagal trigger OTA ke IoT Hub: ${error.message}`);
            }
        }
    }
});