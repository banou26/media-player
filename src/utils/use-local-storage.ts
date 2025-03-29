import { useEffect, useState } from 'react'

export const useLocalStorage = <T,>(name: string, defaultValue?: T) => {
  const [storageValue, setStorageValue] = useState(() => localStorage.getItem(name) ?? defaultValue)

  const updateStorage = (newValue: string) => {
    localStorage.setItem(name, newValue)
    setStorageValue(newValue)
    window.dispatchEvent(new Event('storage'))
  }

  useEffect(() => {
    const syncLocalStorage = () => {
      const item = localStorage.getItem(name)
      setStorageValue(item ?? defaultValue)
    }

    window.addEventListener('storage', syncLocalStorage)
    return () => {
      window.removeEventListener('storage', syncLocalStorage)
    }
  }, [name])

  return [storageValue, updateStorage] as const
}

export default useLocalStorage

export type booleanType = 'true' | 'false' | undefined

