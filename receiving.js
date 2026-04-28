/**
 * Receiving Wizard - 6-step material receiving form
 * Mirrors the phone app's receiving workflow, writing to the same Supabase tables.
 */

// ── Constants (from QR_Asset_Scanner/constants/materialTypes.ts) ──

const MATERIAL_TYPES = [
    'Pipe', 'Fitting', 'Valve', 'Flange', 'Structural Steel', 'Plate',
    'Tubing', 'Bolt/Fastener', 'Gasket', 'Electrical', 'Instrumentation', 'Other'
];

const SIZES = [
    '1/2"', '3/4"', '1"', '1-1/2"', '2"', '3"', '4"', '6"',
    '8"', '10"', '12"', '14"', '16"', '18"', '20"', '24"', '30"', '36"'
];

const GRADES = [
    'A105', 'A106 Gr B', 'A312 TP304', 'A312 TP316',
    'A333 Gr 6', 'A350 LF2', 'A516 Gr 70', 'B16'
];

const STEP_COUNT = 6;

// ── Wizard State ──

let wizardState = {
    currentStep: 0,
    qrCodeValue: '',
    qrCodeId: null,
    material: {
        material_type: '',
        qty: 1,
        size: '',
        grade: '',
        weight: null,
        description: '',
        spec: '',
    },
    po: {
        vendor: '',
        po_number: '',
        delivery_ticket: '',
        carrier: '',
    },
    photos: [],           // { file: File, dataUrl: string, photo_type: string }
    selectedPhotoType: 'general',
    inspection: {
        condition: 'good',
        damage_notes: '',
        inspection_pass: true,
    },
    decision: {
        status: 'accepted',
        has_exception: false,
        exception_type: null,
    },
    location: {
        location_id: '',
    },
    locations: [],        // cached from Supabase
    submitting: false,
};

// ── Initialization ──

document.addEventListener('DOMContentLoaded', () => {
    buildMaterialTypeGrid();
    buildDataLists();
    bindEvents();
});

function buildMaterialTypeGrid() {
    const grid = document.getElementById('materialTypeGrid');
    MATERIAL_TYPES.forEach(type => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'material-type-btn';
        btn.textContent = type;
        btn.addEventListener('click', () => {
            grid.querySelectorAll('.material-type-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            wizardState.material.material_type = type;
            document.getElementById('materialTypeError').style.display = 'none';
        });
        grid.appendChild(btn);
    });
}

function buildDataLists() {
    const sizeList = document.getElementById('sizeList');
    SIZES.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s;
        sizeList.appendChild(opt);
    });

    const gradeList = document.getElementById('gradeList');
    GRADES.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g;
        gradeList.appendChild(opt);
    });
}

function bindEvents() {
    document.getElementById('btnAutoGenerate').addEventListener('click', () => {
        document.getElementById('qrCodeInput').value = generateQRCode();
        document.getElementById('qrCodeInput').classList.remove('is-invalid');
    });

    document.getElementById('btnStartWizard').addEventListener('click', startWizard);

    document.getElementById('qrCodeInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') startWizard();
    });

    document.getElementById('photoInput').addEventListener('change', handlePhotoSelect);
}

// ── QR Code ──

function generateQRCode() {
    const hex = Array.from(crypto.getRandomValues(new Uint8Array(4)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
    return 'QR-' + hex;
}

function startWizard() {
    const input = document.getElementById('qrCodeInput');
    const value = input.value.trim();
    if (!value) {
        input.classList.add('is-invalid');
        return;
    }
    input.classList.remove('is-invalid');
    wizardState.qrCodeValue = value;

    document.getElementById('qrSection').style.display = 'none';
    document.getElementById('stepIndicator').style.display = 'flex';
    document.getElementById('wizardContainer').style.display = 'block';
    showStep(0);
}

// ── Step Navigation ──

function showStep(index) {
    wizardState.currentStep = index;

    document.querySelectorAll('.wizard-step').forEach(el => {
        el.style.display = 'none';
    });
    const stepEl = document.getElementById('step-' + index);
    if (stepEl) stepEl.style.display = 'block';

    updateStepIndicator(index);

    if (index === 5 && wizardState.locations.length === 0) {
        loadLocations();
    }
}

function nextStep() {
    const step = wizardState.currentStep;
    collectStepData(step);

    const validation = validateStep(step);
    if (!validation.valid) {
        showValidationErrors(step, validation.errors);
        return;
    }
    clearValidationErrors(step);

    if (step === 3) {
        updateDecisionConditionals();
    }

    showStep(step + 1);
}

function prevStep() {
    collectStepData(wizardState.currentStep);
    showStep(wizardState.currentStep - 1);
}

function updateStepIndicator(activeStep) {
    document.querySelectorAll('.step-dot').forEach(dot => {
        const s = parseInt(dot.dataset.step);
        dot.classList.remove('active', 'completed');
        if (s === activeStep) {
            dot.classList.add('active');
        } else if (s < activeStep) {
            dot.classList.add('completed');
        }
    });
}

// ── Data Collection ──

function collectStepData(step) {
    switch (step) {
        case 0:
            wizardState.material.qty = parseInt(document.getElementById('inputQty').value) || 1;
            wizardState.material.size = document.getElementById('inputSize').value.trim();
            wizardState.material.grade = document.getElementById('inputGrade').value.trim();
            const weight = parseFloat(document.getElementById('inputWeight').value);
            wizardState.material.weight = isNaN(weight) ? null : weight;
            wizardState.material.description = document.getElementById('inputDescription').value.trim();
            wizardState.material.spec = document.getElementById('inputSpec').value.trim();
            break;
        case 1:
            wizardState.po.vendor = document.getElementById('inputVendor').value.trim();
            wizardState.po.po_number = document.getElementById('inputPONumber').value.trim();
            wizardState.po.delivery_ticket = document.getElementById('inputDeliveryTicket').value.trim();
            wizardState.po.carrier = document.getElementById('inputCarrier').value.trim();
            break;
        case 3:
            wizardState.inspection.damage_notes = document.getElementById('inputDamageNotes').value.trim();
            break;
    }
}

// ── Validation ──

function validateStep(step) {
    const errors = {};
    switch (step) {
        case 0:
            if (!wizardState.material.material_type) {
                errors.material_type = 'Please select a material type';
            }
            if (!wizardState.material.qty || wizardState.material.qty < 1) {
                errors.qty = 'Quantity must be at least 1';
            }
            break;
        case 4:
            if (wizardState.decision.has_exception && !wizardState.decision.exception_type) {
                errors.exception_type = 'Please select an exception type';
            }
            break;
        case 5:
            if (!wizardState.location.location_id) {
                errors.location_id = 'Please select a storage location';
            }
            break;
    }
    return { valid: Object.keys(errors).length === 0, errors };
}

function showValidationErrors(step, errors) {
    if (errors.material_type) {
        document.getElementById('materialTypeError').style.display = 'block';
    }
    if (errors.qty) {
        document.getElementById('inputQty').classList.add('is-invalid');
    }
    if (errors.exception_type) {
        document.getElementById('exceptionTypeError').style.display = 'block';
    }
    if (errors.location_id) {
        document.getElementById('locationSelectError').style.display = 'block';
    }
}

function clearValidationErrors(step) {
    document.getElementById('materialTypeError').style.display = 'none';
    document.getElementById('inputQty').classList.remove('is-invalid');
    document.getElementById('exceptionTypeError').style.display = 'none';
    document.getElementById('locationSelectError').style.display = 'none';
}

// ── Button Selection Handlers ──

function selectCondition(btn) {
    const group = document.getElementById('conditionGroup');
    group.querySelectorAll('.btn-choice').forEach(b => {
        b.classList.remove('selected', 'selected-success', 'selected-danger', 'selected-warning');
    });
    const value = btn.dataset.value;
    wizardState.inspection.condition = value;

    if (value === 'good') btn.classList.add('selected-success');
    else if (value === 'damaged') btn.classList.add('selected-danger');
    else btn.classList.add('selected-warning');

    const damageSection = document.getElementById('damageNotesSection');
    damageSection.style.display = (value === 'damaged' || value === 'mixed') ? 'block' : 'none';
}

function selectInspectionPass(btn) {
    const group = document.getElementById('inspectionPassGroup');
    group.querySelectorAll('.btn-choice').forEach(b => {
        b.classList.remove('selected', 'selected-success', 'selected-danger');
    });
    const value = btn.dataset.value === 'true';
    wizardState.inspection.inspection_pass = value;
    btn.classList.add(value ? 'selected-success' : 'selected-danger');
}

function selectStatus(btn) {
    const group = document.getElementById('statusGroup');
    group.querySelectorAll('.btn-choice').forEach(b => {
        b.classList.remove('selected', 'selected-success', 'selected-danger', 'selected-warning');
    });
    const value = btn.dataset.value;
    wizardState.decision.status = value;

    if (value === 'accepted') btn.classList.add('selected-success');
    else if (value === 'rejected') btn.classList.add('selected-danger');
    else btn.classList.add('selected-warning');
}

function selectExceptionFlag(btn) {
    const group = document.getElementById('exceptionFlagGroup');
    group.querySelectorAll('.btn-choice').forEach(b => {
        b.classList.remove('selected');
    });
    btn.classList.add('selected');
    const value = btn.dataset.value === 'true';
    wizardState.decision.has_exception = value;

    document.getElementById('exceptionTypeSection').style.display = value ? 'block' : 'none';
    if (!value) {
        wizardState.decision.exception_type = null;
        document.getElementById('exceptionTypeGroup').querySelectorAll('.btn-choice').forEach(b => {
            b.classList.remove('selected');
        });
    }
}

function selectExceptionType(btn) {
    const group = document.getElementById('exceptionTypeGroup');
    group.querySelectorAll('.btn-choice').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    wizardState.decision.exception_type = btn.dataset.value;
    document.getElementById('exceptionTypeError').style.display = 'none';
}

function updateDecisionConditionals() {
    const autoException =
        wizardState.inspection.condition === 'damaged' ||
        wizardState.inspection.condition === 'mixed' ||
        !wizardState.inspection.inspection_pass;

    const autoAlert = document.getElementById('autoExceptionAlert');
    const flagSection = document.getElementById('exceptionFlagSection');
    const typeSection = document.getElementById('exceptionTypeSection');

    if (autoException) {
        wizardState.decision.has_exception = true;
        autoAlert.style.display = 'block';
        flagSection.style.display = 'none';
        typeSection.style.display = 'block';
    } else {
        autoAlert.style.display = 'none';
        flagSection.style.display = 'block';
        typeSection.style.display = wizardState.decision.has_exception ? 'block' : 'none';
    }
}

// ── Photo Handling ──

function selectPhotoType(btn) {
    document.getElementById('photoTypeGroup').querySelectorAll('.btn-choice').forEach(b => {
        b.classList.remove('selected');
    });
    btn.classList.add('selected');
    wizardState.selectedPhotoType = btn.dataset.value;
}

function handlePhotoSelect(event) {
    const files = event.target.files;
    for (const file of files) {
        const reader = new FileReader();
        reader.onload = (e) => {
            wizardState.photos.push({
                file: file,
                dataUrl: e.target.result,
                photo_type: wizardState.selectedPhotoType,
            });
            renderPhotoGrid();
        };
        reader.readAsDataURL(file);
    }
    event.target.value = '';
}

function removePhoto(index) {
    wizardState.photos.splice(index, 1);
    renderPhotoGrid();
}

function renderPhotoGrid() {
    const grid = document.getElementById('photoGrid');
    const count = document.getElementById('photoCount');

    if (wizardState.photos.length === 0) {
        grid.innerHTML = '';
        count.textContent = 'No photos added yet (optional)';
        return;
    }

    count.textContent = wizardState.photos.length + ' photo(s) attached';
    grid.innerHTML = wizardState.photos.map((photo, i) => `
        <div class="photo-card">
            <img src="${photo.dataUrl}" alt="Photo ${i + 1}">
            <div class="photo-info">
                <span class="badge bg-secondary">${formatPhotoType(photo.photo_type)}</span>
                <button class="btn-remove-photo" onclick="removePhoto(${i})"><i class="fas fa-times"></i></button>
            </div>
        </div>
    `).join('');
}

function formatPhotoType(type) {
    const labels = { general: 'General', damage: 'Damage', delivery_ticket: 'Delivery Ticket' };
    return labels[type] || type;
}

// ── Location Loading ──

async function loadLocations() {
    const loading = document.getElementById('locationLoading');
    const errorEl = document.getElementById('locationError');
    const list = document.getElementById('locationList');

    loading.style.display = 'block';
    errorEl.style.display = 'none';
    list.innerHTML = '';

    try {
        const { data, error } = await projectSupabaseClient.from('locations')
            .select('*')
            .order('zone')
            .order('row')
            .order('rack');

        if (error) throw error;

        wizardState.locations = data || [];
        renderLocationList();
    } catch (err) {
        errorEl.textContent = 'Failed to load locations: ' + err.message;
        errorEl.style.display = 'block';
    } finally {
        loading.style.display = 'none';
    }
}

function renderLocationList() {
    const list = document.getElementById('locationList');

    if (wizardState.locations.length === 0) {
        list.innerHTML = '<p class="text-muted text-center py-3">No locations configured.</p>';
        return;
    }

    list.innerHTML = wizardState.locations.map(loc => {
        const selected = wizardState.location.location_id === loc.id ? 'selected' : '';
        const holdBadge = loc.is_hold_area
            ? '<span class="badge bg-danger ms-2">HOLD AREA</span>'
            : '';
        return `
            <div class="location-card ${selected}" data-id="${loc.id}" onclick="selectLocation('${loc.id}')">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <strong>${loc.zone}</strong> - Row ${loc.row}, Rack ${loc.rack}
                        ${holdBadge}
                    </div>
                    ${selected ? '<i class="fas fa-check-circle" style="color: var(--primary-blue); font-size: 1.2rem;"></i>' : ''}
                </div>
            </div>
        `;
    }).join('');
}

function selectLocation(id) {
    wizardState.location.location_id = id;
    document.getElementById('locationSelectError').style.display = 'none';
    renderLocationList();
}

// ── Supabase: QR Code Lookup/Create ──

async function lookupOrCreateQRCode(codeValue) {
    const { data: existing } = await projectSupabaseClient.from('qr_codes')
        .select('*')
        .eq('code_value', codeValue)
        .single();

    if (existing) {
        return { id: existing.id, isNew: false };
    }

    const { data: created, error } = await projectSupabaseClient.from('qr_codes')
        .insert({ code_value: codeValue, entity_type: 'item' })
        .select()
        .single();

    if (error) throw new Error('Failed to create QR code: ' + error.message);
    return { id: created.id, isNew: true };
}

// ── Supabase: Photo Upload ──

async function uploadPhoto(photo, receivingRecordId) {
    const fileName = `${receivingRecordId}/${Date.now()}_${photo.photo_type}.jpg`;

    const { error } = await supabaseClient.storage
        .from('inspection-photos')
        .upload(fileName, photo.file, { contentType: photo.file.type || 'image/jpeg' });

    if (error) throw new Error('Photo upload failed: ' + error.message);
    return fileName;
}

// ── Submission ──

async function handleSubmit() {
    collectStepData(wizardState.currentStep);

    const validation = validateStep(5);
    if (!validation.valid) {
        showValidationErrors(5, validation.errors);
        return;
    }

    const submitBtn = document.getElementById('btnSubmit');
    const errorEl = document.getElementById('submitError');
    errorEl.style.display = 'none';

    wizardState.submitting = true;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Submitting...';

    try {
        // Get current user
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) throw new Error('Not authenticated. Please sign in again.');
        const userId = session.user.id;

        // Lookup or create QR code
        const qr = await lookupOrCreateQRCode(wizardState.qrCodeValue);
        wizardState.qrCodeId = qr.id;

        // Insert receiving record
        const { data: record, error: recordError } = await projectSupabaseClient.from('receiving_records')
            .insert({
                qr_code_id: wizardState.qrCodeId,
                status: wizardState.decision.status,
                material_type: wizardState.material.material_type,
                size: wizardState.material.size || null,
                grade: wizardState.material.grade || null,
                qty: wizardState.material.qty,
                weight: wizardState.material.weight,
                description: wizardState.material.description || null,
                spec: wizardState.material.spec || null,
                vendor: wizardState.po.vendor || null,
                po_number: wizardState.po.po_number || null,
                delivery_ticket: wizardState.po.delivery_ticket || null,
                carrier: wizardState.po.carrier || null,
                condition: wizardState.inspection.condition,
                damage_notes: wizardState.inspection.damage_notes || null,
                inspection_pass: wizardState.inspection.inspection_pass,
                has_exception: wizardState.decision.has_exception,
                exception_type: wizardState.decision.exception_type || null,
                exception_resolved: false,
                location_id: wizardState.location.location_id,
                created_by: userId,
            })
            .select()
            .single();

        if (recordError) throw new Error('Failed to save record: ' + recordError.message);

        // Upload photos
        for (const photo of wizardState.photos) {
            try {
                const storagePath = await uploadPhoto(photo, record.id);
                await projectSupabaseClient.from('inspection_photos')
                    .insert({
                        receiving_record_id: record.id,
                        storage_path: storagePath,
                        photo_type: photo.photo_type,
                    });
            } catch (photoErr) {
                console.warn('Photo upload/save warning:', photoErr.message);
            }
        }

        // Link QR code to receiving record
        await projectSupabaseClient.from('qr_codes')
            .update({ entity_id: record.id })
            .eq('id', wizardState.qrCodeId);

        // Auto-create material if accepted
        if (wizardState.decision.status === 'accepted' || wizardState.decision.status === 'partially_accepted') {
            await projectSupabaseClient.from('materials').insert({
                receiving_record_id: record.id,
                qr_code_id: wizardState.qrCodeId,
                material_type: wizardState.material.material_type,
                size: wizardState.material.size || null,
                grade: wizardState.material.grade || null,
                qty: wizardState.material.qty,
                current_quantity: wizardState.material.qty,
                weight: wizardState.material.weight,
                spec: wizardState.material.spec || null,
                location_id: wizardState.location.location_id,
                status: 'in_yard',
            });
        }

        // Audit log
        await supabaseClient.from('audit_log').insert({
            user_id: userId,
            action: 'receiving_created',
            entity_type: 'receiving_record',
            entity_id: record.id,
            details: {
                project_id: InvenioProjectScope.getActiveProjectId(),
                material_type: wizardState.material.material_type,
                qty: wizardState.material.qty,
                status: wizardState.decision.status,
                has_exception: wizardState.decision.has_exception,
            },
        });

        // Show success
        document.getElementById('wizardContainer').style.display = 'none';
        document.getElementById('stepIndicator').style.display = 'none';
        document.getElementById('successState').style.display = 'block';
        document.getElementById('successMessage').textContent =
            `Receiving record for ${wizardState.material.qty}x ${wizardState.material.material_type} (${wizardState.qrCodeValue}) has been saved.`;

    } catch (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
    } finally {
        wizardState.submitting = false;
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-check me-1"></i> Submit';
    }
}

// ── Reset ──

function resetWizard() {
    wizardState = {
        currentStep: 0,
        qrCodeValue: '',
        qrCodeId: null,
        material: { material_type: '', qty: 1, size: '', grade: '', weight: null, description: '', spec: '' },
        po: { vendor: '', po_number: '', delivery_ticket: '', carrier: '' },
        photos: [],
        selectedPhotoType: 'general',
        inspection: { condition: 'good', damage_notes: '', inspection_pass: true },
        decision: { status: 'accepted', has_exception: false, exception_type: null },
        location: { location_id: '' },
        locations: wizardState.locations,  // keep cached locations
        submitting: false,
    };

    // Reset QR section
    document.getElementById('qrCodeInput').value = '';
    document.getElementById('qrSection').style.display = 'block';

    // Hide wizard & success
    document.getElementById('wizardContainer').style.display = 'none';
    document.getElementById('stepIndicator').style.display = 'none';
    document.getElementById('successState').style.display = 'none';
    document.getElementById('submitError').style.display = 'none';

    // Reset material type buttons
    document.getElementById('materialTypeGrid').querySelectorAll('.material-type-btn').forEach(b => b.classList.remove('selected'));

    // Reset form inputs
    document.getElementById('inputQty').value = '1';
    document.getElementById('inputSize').value = '';
    document.getElementById('inputGrade').value = '';
    document.getElementById('inputWeight').value = '';
    document.getElementById('inputDescription').value = '';
    document.getElementById('inputSpec').value = '';
    document.getElementById('inputVendor').value = '';
    document.getElementById('inputPONumber').value = '';
    document.getElementById('inputDeliveryTicket').value = '';
    document.getElementById('inputCarrier').value = '';
    document.getElementById('inputDamageNotes').value = '';

    // Reset choice buttons to defaults
    resetChoiceGroup('conditionGroup', 'good', 'selected-success');
    resetChoiceGroup('inspectionPassGroup', 'true', 'selected-success');
    resetChoiceGroup('statusGroup', 'accepted', 'selected-success');
    resetChoiceGroup('exceptionFlagGroup', 'false', 'selected');

    document.getElementById('exceptionTypeGroup').querySelectorAll('.btn-choice').forEach(b => b.classList.remove('selected'));
    document.getElementById('photoTypeGroup').querySelectorAll('.btn-choice').forEach(b => b.classList.remove('selected'));
    document.getElementById('photoTypeGroup').querySelector('[data-value="general"]').classList.add('selected');

    // Hide conditional sections
    document.getElementById('damageNotesSection').style.display = 'none';
    document.getElementById('autoExceptionAlert').style.display = 'none';
    document.getElementById('exceptionFlagSection').style.display = 'none';
    document.getElementById('exceptionTypeSection').style.display = 'none';

    // Reset photos
    renderPhotoGrid();

    // Reset location selection visually
    renderLocationList();

    // Clear errors
    clearValidationErrors(0);
}

function resetChoiceGroup(groupId, defaultValue, selectedClass) {
    const group = document.getElementById(groupId);
    group.querySelectorAll('.btn-choice').forEach(b => {
        b.classList.remove('selected', 'selected-success', 'selected-danger', 'selected-warning');
        if (b.dataset.value === defaultValue) {
            b.classList.add(selectedClass);
        }
    });
}
