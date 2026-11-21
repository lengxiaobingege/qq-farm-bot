import { ref } from 'vue'

// Settings 页四个 Tab 共用的「提示弹窗」状态（单例）。
// 弹窗本体渲染在 Settings.vue，子 Tab 组件通过 showAlert() 触发。
const modalVisible = ref(false)
const modalConfig = ref({
  title: '',
  message: '',
  type: 'primary' as 'primary' | 'danger',
  isAlert: true,
})

function showAlert(message: string, type: 'primary' | 'danger' = 'primary') {
  modalConfig.value = {
    title: type === 'danger' ? '错误' : '提示',
    message,
    type,
    isAlert: true,
  }
  modalVisible.value = true
}

export function useSettingsAlert() {
  return { modalVisible, modalConfig, showAlert }
}
