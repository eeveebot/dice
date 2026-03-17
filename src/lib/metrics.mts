import {
  commandCounter,
  commandProcessingTime,
  commandErrorCounter,
  natsPublishCounter,
  natsSubscribeCounter,
  log,
} from '@eeveebot/libeevee';

// Function to record command execution
export function recordDiceCommand(
  platform: string,
  network: string,
  channel: string,
  result: string
): void {
  try {
    commandCounter.inc({
      module: 'dice',
      platform,
      network,
      channel,
      result,
    });
  } catch (error) {
    log.error('Failed to record dice command metric', {
      producer: 'dice-metrics',
      error,
    });
  }
}

// Function to record processing time
export function recordProcessingTime(duration: number): void {
  try {
    commandProcessingTime.observe({ module: 'dice' }, duration);
  } catch (error) {
    log.error('Failed to record dice processing time metric', {
      producer: 'dice-metrics',
      error,
    });
  }
}

// Function to record errors
export function recordDiceError(errorType: string): void {
  try {
    commandErrorCounter.inc({
      module: 'dice',
      type: errorType,
    });
  } catch (error) {
    log.error('Failed to record dice error metric', {
      producer: 'dice-metrics',
      error,
    });
  }
}

// Function to record NATS publish operations
export function recordNatsPublish(subject: string, messageType: string): void {
  try {
    natsPublishCounter.inc({
      module: 'dice',
      type: messageType,
    });
  } catch (error) {
    log.error('Failed to record NATS publish metric', {
      producer: 'dice-metrics',
      error,
    });
  }
}

// Function to record NATS subscribe operations
export function recordNatsSubscribe(subject: string): void {
  try {
    natsSubscribeCounter.inc({
      module: 'dice',
      subject: subject,
    });
  } catch (error) {
    log.error('Failed to record NATS subscribe metric', {
      producer: 'dice-metrics',
      error,
    });
  }
}