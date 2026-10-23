const { app } = require('@azure/functions');
const { Registry } = require('azure-iothub');
const { 
    generateBlobSASQueryParameters, 
    BlobSASPermissions, 
    StorageSharedKeyCredential 
} = require('@azure/storage-blob');

const IOTHUB_CONNECTION_STRING = process.env.IotHubRegistryConnectionString;
const STORAGE_ACCOUNT_NAME = process.env.StorageAccountName || "storageesp32ota";
const STORAGE_ACCOUNT_KEY = process.env.StorageAccountKey; // Ambil dari Storage Account -> Access Keys

const registry = Registry.fromConnectionString(IOTHUB_CONNECTION_STRING);

// Fungsi untuk menghasilkan URL bertoken SAS
function generateSasUrl(blobName) {
    if (!STORAGE_ACCOUNT_KEY) {
        throw new Error("StorageAccountKey belum dipasang di Application Settings.");
    }

    const sharedKeyCredential = new StorageSharedKeyCredential(
        STORAGE_ACCOUNT_NAME, 
        STORAGE_ACCOUNT_KEY
    );

    // Set token berlaku dari sekarang sampai 2 jam ke depan
    const startsOn = new Date();
    const expiresOn = new Date(startsOn.getTime() + 2 * 60 * 60 * 1000);

    const sasOptions = {
        containerName: "firmware",
        blobName: blobName,
        permissions: BlobSASPermissions.parse("r"), // Izin Read saja
        startsOn: startsOn,
        expiresOn: expiresOn
    };

    const sasToken = generateBlobSASQueryParameters(sasOptions, sharedKeyCredential).toString();
    return `https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net/firmware/${encodeURIComponent(blobName)}?${sasToken}`;
}

app.eventGrid('trigger-ota', {
    handler: async (event, context) => {
        context.log('Event Grid OTA Triggered:', event);

        if (event.eventType === 'Microsoft.Storage.BlobCreated') {
            const rawUrl = event.data.url;
            
            if (!rawUrl.includes('/firmware/') || !rawUrl.endsWith('.bin')) {
                context.log('File diabaikan karena bukan firmware (.bin)');
                return;
            }

            const fileName = decodeURIComponent(rawUrl.split('/').pop());
            const targetVersion = fileName.replace('.bin', '');
            const targetDevice = "esp32s3-device-01"; 

            try {
                // Generate SAS URL yang aman untuk Blob Private
                const sasBlobUrl = generateSasUrl(fileName);
                context.log(`Generated Secure SAS URL for ${fileName}`);

                const twin = await registry.getTwin(targetDevice);
                
                const twinPatch = {
                    properties: {
                        desired: {
                            firmware_url: sasBlobUrl,
                            target_version: targetVersion,
                            update_trigger: new Date().toISOString()
                        }
                    }
                };

                await registry.updateTwin(targetDevice, twinPatch, twin.responseBody.etag);
                context.log(`✅ Instruksi OTA bertoken SAS dikirim ke Device: ${targetDevice}`);
            } catch (error) {
                context.error(`❌ Gagal trigger OTA ke IoT Hub: ${error.message}`);
            }
        }
    }
});