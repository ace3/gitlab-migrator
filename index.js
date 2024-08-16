import * as dotenv from 'dotenv'

import FormData from 'form-data'
import axios from 'axios'
import fs from 'fs'
import path from 'path'

dotenv.config()
// Configuration

const selfHostedGitlab = process.env.SELF_HOSTED_GITLAB_URL
const cloudGitlab = 'https://gitlab.com'
const selfHostedToken = process.env.SELF_HOSTED_TOKEN
if (SELF_HOSTED_TOKEN == null) {
  throw new Error('SELF_HOSTED_TOKEN is not set')
}
const cloudToken = process.env.CLOUD_TOKEN
if (CLOUD_TOKEN == null) {
  throw new Error('CLOUD_TOKEN is not set')
}
// ------------------------------
const projectId = 'nobi-corp/earn-investment-automation'
const destinationSlug = projectId.replaceAll('nobi-corp/', '') // 'nobi-automation-karate-api' // Slug for the new project
// ------------------------------
const namespace = 'hmcorp' // ID of the group (hmcorp) where the project will be imported
const exportFilePath = path.join(__dirname, 'export.tar.gz')

// Axios instances with separate tokens
const selfHostedAxios = axios.create({
  headers: {
    'PRIVATE-TOKEN': selfHostedToken,
  },
})

const cloudAxios = axios.create({
  headers: {
    'PRIVATE-TOKEN': cloudToken,
  },
})

// Step 1: Trigger Export
async function triggerExport() {
  try {
    const exportUrl = `${selfHostedGitlab}/api/v4/projects/${encodeURIComponent(
      projectId
    )}/export`
    const response = await selfHostedAxios.post(exportUrl)
    if (response.status === 202) {
      console.log('Export triggered successfully.')
      await checkExportStatus()
    } else {
      console.error('Failed to trigger export:', response.data)
    }
  } catch (error) {
    console.error('Error triggering export:', error)
  }
}

// Step 2: Check Export Status and Download the Export File
async function checkExportStatus() {
  const maxRetries = 5
  let retries = 0

  try {
    const statusUrl = `${selfHostedGitlab}/api/v4/projects/${encodeURIComponent(
      projectId
    )}/export`
    while (true) {
      try {
        const response = await selfHostedAxios.get(statusUrl)
        if (response.data.export_status === 'finished') {
          console.log('Export completed. Downloading the file...')
          await downloadExport()
          break
        } else {
          console.log('Export still in progress. Waiting...')
          await new Promise((resolve) => setTimeout(resolve, 10000)) // Wait 10 seconds
        }
      } catch (error) {
        if (retries < maxRetries) {
          retries++
          console.error(
            `Error checking export status, retrying... (${retries}/${maxRetries})`
          )
          await new Promise((resolve) => setTimeout(resolve, 5000)) // Wait 5 seconds before retrying
        } else {
          console.error(
            'Max retries reached. Error checking export status:',
            error
          )
          break
        }
      }
    }
  } catch (error) {
    console.error('Error checking export status:', error)
  }
}

// Step 3: Download the Export File
async function downloadExport() {
  try {
    const downloadUrl = `${selfHostedGitlab}/api/v4/projects/${encodeURIComponent(
      projectId
    )}/export/download`
    const response = await selfHostedAxios.get(downloadUrl, {
      responseType: 'stream',
    })
    const writer = fs.createWriteStream(exportFilePath)
    response.data.pipe(writer)
    writer.on('finish', async () => {
      console.log('File downloaded successfully.')
      await checkAndRenameExistingProject()
    })
  } catch (error) {
    console.error('Error downloading the export file:', error)
  }
}

// Step 4: Check if the Project Already Exists in the Cloud GitLab
async function checkAndRenameExistingProject() {
  try {
    const checkUrl = `${cloudGitlab}/api/v4/projects/${encodeURIComponent(
      `${namespace}/${destinationSlug}`
    )}`
    const response = await cloudAxios.get(checkUrl)

    if (response.status === 200) {
      console.log('Project already exists. Renaming the existing project...')

      // Rename the existing project
      const renameUrl = `${cloudGitlab}/api/v4/projects/${response.data.id}`
      const newName = `${response.data.name}-delete`
      const newPath = `${response.data.path}-delete`

      await cloudAxios.put(renameUrl, {
        name: newName,
        path: newPath,
      })

      console.log(`Project renamed to ${newName} with path ${newPath}.`)
    }
  } catch (error) {
    if (error.response && error.response.status === 404) {
      console.log('Project does not exist. Proceeding with import...')
    } else {
      console.error('Error checking or renaming existing project:', error)
      return
    }
  }

  await importProjectToCloud()
}

// Step 5: Import the Project to Cloud GitLab into a Specific Group
async function importProjectToCloud() {
  try {
    const importUrl = `${cloudGitlab}/api/v4/projects/import`
    const formData = new FormData()
    formData.append('file', fs.createReadStream(exportFilePath))
    formData.append('path', destinationSlug) // Set the destination project slug
    formData.append('namespace', namespace) // Specify the group path (namespace)

    const response = await cloudAxios.post(importUrl, formData, {
      headers: {
        ...formData.getHeaders(),
      },
    })
    if (response.status === 201) {
      console.log('Import started successfully.')
      await archiveSourceProject()
    } else {
      console.error('Failed to start import:', response.data)
    }
  } catch (error) {
    console.error('Error importing project:', error)
  }
}

// Step 6: Archive the Source Project
async function archiveSourceProject() {
  try {
    const archiveUrl = `${selfHostedGitlab}/api/v4/projects/${encodeURIComponent(
      projectId
    )}/archive`
    const response = await selfHostedAxios.post(archiveUrl)
    if (response.status === 201) {
      console.log('Source project archived successfully.')
      await deleteExportFile()
      console.log(
        `Check the process here: ${cloudGitlab}/hmcorp/${destinationSlug}`
      )
    } else {
      console.error('Failed to archive source project:', response.data)
    }
  } catch (error) {
    console.error('Error archiving source project:', error)
  }
}

// Step 7: Delete the Export File
async function deleteExportFile() {
  try {
    fs.unlinkSync(exportFilePath)
    console.log('Export file deleted successfully.')
  } catch (error) {
    console.error('Error deleting export file:', error)
  }
}

// Start the Process
triggerExport()
