export function onlyDigits(value: unknown) {
  return String(value ?? '').replace(/\D/g, '')
}

export function formatCnpj(value: unknown) {
  const digits = onlyDigits(value).slice(0, 14)
  return digits
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

export function normalizeCnpj(value: unknown) {
  const digits = onlyDigits(value)
  return digits.length === 14 ? digits : null
}

export function isValidCnpj(value: unknown) {
  const cnpj = normalizeCnpj(value)
  if (!cnpj || /^(\d)\1{13}$/.test(cnpj)) {
    return false
  }

  const calculateDigit = (base: string, weights: number[]) => {
    const sum = weights.reduce((total, weight, index) => total + Number(base[index]) * weight, 0)
    const remainder = sum % 11
    return remainder < 2 ? 0 : 11 - remainder
  }

  const firstDigit = calculateDigit(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const secondDigit = calculateDigit(cnpj.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])

  return firstDigit === Number(cnpj[12]) && secondDigit === Number(cnpj[13])
}
